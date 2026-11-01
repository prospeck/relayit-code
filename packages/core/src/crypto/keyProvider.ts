import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Where the 32-byte master key comes from.
 * - Desktop: the Tauri shell reads it from the OS keychain and writes it to our stdin.
 * - Dev/tests: a key file in the dev data folder (never used in release builds).
 * - Cloud (later): a KMS-backed provider.
 */
export interface KeyProvider {
  getMasterKey(): Promise<Buffer>;
}

export class StaticKeyProvider implements KeyProvider {
  private key: Buffer;
  constructor(key: Buffer) {
    this.key = key;
  }
  async getMasterKey(): Promise<Buffer> {
    return this.key;
  }
}

/** Reads one line "RELAYIT_MASTER_KEY=<base64>" from stdin, sent by the Tauri shell. */
export class StdinKeyProvider implements KeyProvider {
  private keyPromise: Promise<Buffer> | null = null;
  getMasterKey(): Promise<Buffer> {
    this.keyPromise ??= new Promise((resolve, reject) => {
      let buf = "";
      const onData = (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const nl = buf.indexOf("\n");
        if (nl === -1) return;
        process.stdin.off("data", onData);
        const line = buf.slice(0, nl).trim();
        const m = /^RELAYIT_MASTER_KEY=(.+)$/.exec(line);
        if (!m?.[1]) return reject(new Error("Expected master key on stdin"));
        const key = Buffer.from(m[1], "base64");
        if (key.length !== 32) return reject(new Error("Master key must be 32 bytes"));
        resolve(key);
      };
      process.stdin.on("data", onData);
      setTimeout(
        () => reject(new Error("Timed out waiting for master key on stdin")),
        15000,
      ).unref();
    });
    return this.keyPromise;
  }
}

/** Dev only: a key file next to the dev database; POSIX 0600, inherited user-folder ACLs on Windows. */
export class DevFileKeyProvider implements KeyProvider {
  private path: string;
  constructor(path: string) {
    this.path = path;
  }
  async getMasterKey(): Promise<Buffer> {
    if (existsSync(this.path)) return Buffer.from(readFileSync(this.path, "utf8").trim(), "base64");
    mkdirSync(dirname(this.path), { recursive: true });
    const key = randomBytes(32);
    writeFileSync(this.path, key.toString("base64"), { mode: 0o600 });
    if (process.platform !== "win32") chmodSync(this.path, 0o600);
    return key;
  }
}
