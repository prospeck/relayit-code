import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM. Output format: base64url( version(1) | iv(12) | tag(16) | ciphertext ).
 * `aad` binds a ciphertext to its purpose (e.g. the secret's name) so blobs can't be swapped.
 */
const VERSION = 1;

export function encrypt(masterKey: Buffer, plaintext: string, aad: string): string {
  assertKey(masterKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]).toString("base64url");
}

export function decrypt(masterKey: Buffer, blob: string, aad: string): string {
  assertKey(masterKey);
  const raw = Buffer.from(blob, "base64url");
  if (raw.length < 29 || raw[0] !== VERSION) throw new Error("Unrecognised secret format");
  const iv = raw.subarray(1, 13);
  const tag = raw.subarray(13, 29);
  const ct = raw.subarray(29);
  const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

function assertKey(key: Buffer): void {
  if (key.length !== 32) throw new Error("Master key must be 32 bytes");
}
