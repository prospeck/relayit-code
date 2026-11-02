import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const CREDENTIAL_DIRECTORY = ".credentials";
export class CredentialStorageError extends Error {
  constructor() {
    super("Credential storage could not be opened. Restore its key before changing credentials.");
    this.name = "CredentialStorageError";
  }
}
const failure = () => new CredentialStorageError();
const validKey = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const decryptedText = value => typeof value === "string" ? value : value?.result;

function durableWrite(file, value) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, value);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, file);
    if (process.platform !== "win32") {
      fd = openSync(dirname(file), "r");
      fsyncSync(fd);
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}

export function fallbackMasterKey(dataDir) {
  const home = join(dataDir, CREDENTIAL_DIRECTORY);
  if (existsSync(join(home, "master-key.os"))) throw failure();
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = join(home, "master-key");
  if (!existsSync(file)) {
    if (readdirSync(home).some(name => name.endsWith(".enc"))) throw failure();
    let fd;
    try {
      fd = openSync(file, "wx", 0o600);
      writeFileSync(fd, randomBytes(32).toString("hex"));
      fsyncSync(fd);
    } catch (error) {
      if (error?.code !== "EEXIST") throw failure();
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  const key = readFileSync(file, "utf8").trim();
  if (!validKey(key)) throw failure();
  return { key, protection: "key-file" };
}

/** safeStorage must reject Linux's basic_text backend. An existing OS-wrapped key never silently downgrades. */
export async function desktopMasterKey(dataDir, safe) {
  const home = join(dataDir, CREDENTIAL_DIRECTORY);
  const wrapped = join(home, "master-key.os");
  const fallback = join(home, "master-key");
  try {
    if (!(await safe.available())) {
      if (existsSync(wrapped)) throw failure();
      return fallbackMasterKey(dataDir);
    }
    let key;
    if (existsSync(wrapped)) {
      const decrypted = await safe.decrypt(readFileSync(wrapped));
      key = decryptedText(decrypted);
      if (!validKey(key)) throw failure();
      if (decrypted?.shouldReEncrypt) durableWrite(wrapped, await safe.encrypt(key));
    }
    else {
      if (!existsSync(fallback) && existsSync(home) && readdirSync(home).some(name => name.endsWith(".enc"))) throw failure();
      key = existsSync(fallback) ? fallbackMasterKey(dataDir).key : randomBytes(32).toString("hex");
      durableWrite(wrapped, await safe.encrypt(key));
    }
    if (!validKey(key) || decryptedText(await safe.decrypt(readFileSync(wrapped))) !== key) throw failure();
    rmSync(fallback, { force: true });
    return { key, protection: "os-keychain" };
  } catch { throw failure(); }
}

export function credentialProtection(protection) {
  return protection === "os-keychain"
    ? { protection, label: "OS keychain", detail: "Shared credential store: encrypted with an OS-protected master key." }
    : { protection: "key-file", label: "Weaker protection: local key file", detail: "Shared credential store: encrypted, but anyone who can read its local key file and ciphertext can decrypt it." };
}

/** Server-only plaintext access. Namespace is authenticated so ciphertext cannot be moved between stores. */
export class EncryptedCredentialStore {
  constructor(dataDir, master = () => fallbackMasterKey(dataDir)) {
    this.home = join(dataDir, CREDENTIAL_DIRECTORY);
    this.master = master;
  }

  path(name) {
    if (!/^[a-z0-9-]+$/.test(name)) throw failure();
    return join(this.home, `${name}.enc`);
  }

  read(name) {
    const file = this.path(name);
    if (!existsSync(file)) return undefined;
    try {
      const data = readFileSync(file);
      if (data.length < 29 || data[0] !== 1) throw failure();
      const decipher = createDecipheriv("aes-256-gcm", Buffer.from(this.master().key, "hex"), data.subarray(1, 13));
      decipher.setAAD(Buffer.from(`openmausbot-credentials-v1:${name}`));
      decipher.setAuthTag(data.subarray(-16));
      return JSON.parse(Buffer.concat([decipher.update(data.subarray(13, -16)), decipher.final()]).toString("utf8"));
    } catch { throw failure(); }
  }

  write(name, value) {
    try {
      // A damaged store must never be replaced with a partial set of credentials.
      this.read(name);
      const text = JSON.stringify(value);
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", Buffer.from(this.master().key, "hex"), nonce);
      cipher.setAAD(Buffer.from(`openmausbot-credentials-v1:${name}`));
      const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      durableWrite(this.path(name), Buffer.concat([Buffer.from([1]), nonce, body, cipher.getAuthTag()]));
      if (JSON.stringify(this.read(name)) !== text) throw failure();
    } catch { throw failure(); }
  }

  /** The original is removed only after an encrypted write and authenticated read-back. Retry after a crash is safe. */
  migrate(name, load, cleanup) {
    let value = this.read(name);
    if (value === undefined) {
      value = load();
      if (value === undefined) return undefined;
      this.write(name, value);
    }
    cleanup();
    return value;
  }
}
