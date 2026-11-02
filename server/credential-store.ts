import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { createDecipheriv, createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, rmSync } from "node:fs";
import { CredentialStorageError, EncryptedCredentialStore, credentialProtection, fallbackMasterKey, type CredentialMaster } from "../electron/credential-store.mjs";
import { addHeldSecretScrubber, HELD_SECRET_MASK } from "../shared/redact.ts";

type ParentPort = { on(event: "message", listener: (event: { data?: unknown }) => void): void; removeListener(event: "message", listener: (event: { data?: unknown }) => void): void; postMessage(message: object): void };
const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
let desktop: { dataDir: string; master: CredentialMaster } | undefined;
const pending: Array<{ data?: unknown }> = [];
const bufferMessage = (event: { data?: unknown }) => {
  if ((event.data as { type?: string } | undefined)?.type !== "relayit:credential-master") pending.push(event);
};

// Electron utilityProcess supplies a private parentPort. The key never enters argv, env, HTTP, or a bot child.
if (parentPort && process.env.OMB_DESKTOP_PARENT === "1") {
  parentPort.on("message", bufferMessage);
  desktop = await new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error("Desktop credential key was not received.")), 30_000);
    const receive = ({ data }: { data?: unknown }) => {
      const message = data as { type?: string; dataDir?: string; master?: CredentialMaster } | undefined;
      if (message?.type !== "relayit:credential-master") return;
      clearTimeout(timer);
      parentPort.removeListener("message", receive);
      if (message.dataDir !== process.env.OMB_DATA_DIR || !/^[a-f0-9]{64}$/.test(message.master?.key ?? "") ||
          !["os-keychain", "key-file"].includes(message.master?.protection ?? "")) return reject(new Error("Desktop credential key was rejected."));
      accept({ dataDir: message.dataDir!, master: message.master! });
    };
    parentPort.on("message", receive);
    parentPort.postMessage({ type: "relayit:credential-master-request" });
  });
}

export function listenDesktopPrivateMessages(receive: (event: { data?: object }) => void): void {
  parentPort?.removeListener("message", bufferMessage);
  parentPort?.on("message", receive as (event: { data?: unknown }) => void);
  setImmediate(() => { for (const event of pending.splice(0)) receive(event as { data?: object }); });
}

function master(dataDir: string): CredentialMaster {
  if (desktop) {
    const child = relative(resolve(desktop.dataDir), resolve(dataDir));
    if (child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`))) return desktop.master;
  }
  if (process.env.OMB_DESKTOP_PARENT === "1") throw new Error("Desktop credential key is unavailable for this workspace.");
  return fallbackMasterKey(dataDir);
}

const held = new Set<string>();
addHeldSecretScrubber(text => {
  let out = text;
  for (const value of [...held].sort((a, b) => b.length - a.length)) out = out.split(value).join(HELD_SECRET_MASK);
  return out;
});

/** Held values are cut out of everything a person or model reads, by plain text match. A short value isn't a credential
 * worth that: holding "1" or "ollama" would blank every price, ID and mention of it across the app. Saved website
 * passwords and one-time codes have their own scrubber, which keeps short ones. */
const MIN_HELD_CHARS = 8;

/** Remember revoked values too: late provider errors must not leak credentials after rotation. */
export function holdCredentialValues(value: unknown): void {
  if (typeof value === "string" && value.length >= MIN_HELD_CHARS) {
    held.add(value);
    try { held.add(encodeURIComponent(value)); } catch { /* JSON permits unpaired surrogates; redaction must still accept the original value. */ }
    held.add(JSON.stringify(value).slice(1, -1));
  }
}

export function credentialStore(dataDir: string): EncryptedCredentialStore {
  return new EncryptedCredentialStore(dataDir, () => master(dataDir));
}

export function credentialStorageStatus(dataDir: string) {
  return credentialProtection(master(dataDir).protection);
}

export class CredentialDocument<T> {
  private readonly store: EncryptedCredentialStore;
  private readonly name: string;
  private readonly legacy: { file: string; keyFile?: string };
  private readonly parse: (value: unknown) => T;

  constructor(dataDir: string, name: string, legacy: { file: string; keyFile?: string }, parse: (value: unknown) => T) {
    this.store = credentialStore(dataDir);
    this.name = name;
    this.legacy = legacy;
    this.parse = parse;
  }

  read(): T | undefined {
    try {
      const value = this.store.migrate(this.name, () => {
        if (!existsSync(this.legacy.file)) return undefined;
        let raw: string;
        if (this.legacy.keyFile) {
          const key = readFileSync(this.legacy.keyFile, "utf8").trim();
          if (!/^[a-f0-9]{64}$/.test(key)) throw new Error();
          const data = readFileSync(this.legacy.file);
          const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(key).digest(), data.subarray(0, 12));
          decipher.setAuthTag(data.subarray(-16));
          raw = Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString("utf8");
        } else raw = readFileSync(this.legacy.file, "utf8");
        return this.parse(JSON.parse(raw));
      }, () => {
        // Parse before removing originals, including when resuming an interrupted migration.
        this.parse(this.store.read(this.name));
        const removed = existsSync(this.legacy.file) || Boolean(this.legacy.keyFile && existsSync(this.legacy.keyFile));
        rmSync(this.legacy.file, { force: true });
        if (this.legacy.keyFile) rmSync(this.legacy.keyFile, { force: true });
        if (removed && process.platform !== "win32") {
          const fd = openSync(dirname(this.legacy.file), "r");
          try { fsyncSync(fd); } finally { closeSync(fd); }
        }
      });
      return value === undefined ? undefined : this.parse(value);
    } catch { throw new CredentialStorageError(); }
  }

  write(value: T): void {
    this.read();
    this.store.write(this.name, this.parse(value));
  }
}
