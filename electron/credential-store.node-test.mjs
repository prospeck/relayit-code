import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { credentialProtection, desktopMasterKey, EncryptedCredentialStore, fallbackMasterKey } from "./credential-store.mjs";

const dirs = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "relayit-secrets-")); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fakeKeychain() {
  const entries = new Map();
  return {
    available: async () => true,
    encrypt: async value => { const id = `fake-keychain-${entries.size}`; entries.set(id, value); return Buffer.from(id); },
    decrypt: async buffer => { const key = entries.get(buffer.toString()); if (!key) throw new Error("Locked"); return key; },
  };
}

test("AES-256-GCM round trip, random nonces and owner-only files", () => {
  const dir = temp(), store = new EncryptedCredentialStore(dir);
  store.write("fixture", { password: "fixture secret 雨" });
  const first = readFileSync(store.path("fixture"));
  assert.deepEqual(new EncryptedCredentialStore(dir).read("fixture"), { password: "fixture secret 雨" });
  assert.equal(first.includes(Buffer.from("fixture secret")), false);
  store.write("fixture", { password: "fixture secret 雨" });
  assert.notDeepEqual(readFileSync(store.path("fixture")), first);
  if (process.platform !== "win32") {
    assert.equal(statSync(store.path("fixture")).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, ".credentials")).mode & 0o777, 0o700);
    assert.equal(statSync(join(dir, ".credentials/master-key")).mode & 0o777, 0o600);
  }
});

test("tampering fails closed and cannot be overwritten", () => {
  const store = new EncryptedCredentialStore(temp());
  store.write("fixture", { password: "fixture password" });
  const data = readFileSync(store.path("fixture"));
  data[15] ^= 1;
  writeFileSync(store.path("fixture"), data);
  assert.throws(() => store.read("fixture"), /Credential storage could not be opened/);
  assert.throws(() => store.write("fixture", {}));
  assert.deepEqual(readFileSync(store.path("fixture")), data);
});

test("wrong or missing key cannot replace credentials", () => {
  const dir = temp(), store = new EncryptedCredentialStore(dir);
  store.write("fixture", { token: "fixture token" });
  const keyPath = join(dir, ".credentials/master-key");
  writeFileSync(keyPath, "0".repeat(64));
  assert.throws(() => store.read("fixture"));
  rmSync(keyPath);
  assert.throws(() => store.write("fixture", {}));
  assert.equal(existsSync(keyPath), false);
});

test("ciphertext cannot be substituted into another namespace", () => {
  const store = new EncryptedCredentialStore(temp());
  store.write("google", { token: "fixture token" });
  writeFileSync(store.path("logins"), readFileSync(store.path("google")));
  assert.throws(() => store.read("logins"));
});

test("plaintext migration resumes after simulated crash before cleanup", () => {
  const dir = temp(), file = join(dir, "old.json"), store = new EncryptedCredentialStore(dir);
  const value = { access: "fixture access", refresh: "fixture refresh" };
  writeFileSync(file, JSON.stringify(value));
  assert.throws(() => store.migrate("oauth", () => JSON.parse(readFileSync(file)), () => { throw new Error("simulated crash"); }), /simulated crash/);
  assert.equal(existsSync(file), true);
  assert.deepEqual(store.read("oauth"), value);
  const reopened = new EncryptedCredentialStore(dir);
  assert.deepEqual(reopened.migrate("oauth", () => { throw new Error("Must use committed ciphertext"); }, () => rmSync(file)), value);
  assert.equal(existsSync(file), false);
});

test("failed encrypted write preserves the original plaintext", () => {
  const dir = temp(), file = join(dir, "old.json"), store = new EncryptedCredentialStore(dir, () => { throw new Error("Unavailable"); });
  writeFileSync(file, '{"token":"fixture token"}');
  assert.throws(() => store.migrate("oauth", () => JSON.parse(readFileSync(file)), () => rmSync(file)));
  assert.equal(readFileSync(file, "utf8"), '{"token":"fixture token"}');
});

test("desktop wraps a random master with fake keychain and keeps plaintext only in memory", async () => {
  const dir = temp(), safe = fakeKeychain();
  const master = await desktopMasterKey(dir, safe);
  assert.equal(master.protection, "os-keychain");
  assert.equal(existsSync(join(dir, ".credentials/master-key")), false);
  assert.equal(readFileSync(join(dir, ".credentials/master-key.os")).includes(Buffer.from(master.key)), false);
  assert.deepEqual(await desktopMasterKey(dir, safe), master);
  const store = new EncryptedCredentialStore(dir, () => master);
  store.write("fixture", { key: "fixture key" });
  assert.deepEqual(store.read("fixture"), { key: "fixture key" });
  assert.throws(() => new EncryptedCredentialStore(dir).read("fixture"));
});

test("fallback promotion verifies wrapping before removing key file", async () => {
  const dir = temp(), master = fallbackMasterKey(dir), store = new EncryptedCredentialStore(dir);
  store.write("fixture", { token: "fixture token" });
  const promoted = await desktopMasterKey(dir, fakeKeychain());
  assert.equal(promoted.key, master.key);
  assert.equal(existsSync(join(dir, ".credentials/master-key")), false);
  assert.deepEqual(new EncryptedCredentialStore(dir, () => promoted).read("fixture"), { token: "fixture token" });
});

test("failed wrapping and locked keychain preserve credentials and never downgrade", async () => {
  const dir = temp(), master = fallbackMasterKey(dir), safe = fakeKeychain();
  await assert.rejects(desktopMasterKey(dir, { ...safe, decrypt: async () => { throw new Error("Locked"); } }));
  assert.equal(readFileSync(join(dir, ".credentials/master-key"), "utf8"), master.key);
  await assert.rejects(desktopMasterKey(dir, { ...safe, available: async () => false }));
});

test("fallback and Settings label state the weaker guarantee", async () => {
  const master = await desktopMasterKey(temp(), { available: async () => false });
  assert.equal(master.protection, "key-file");
  assert.match(credentialProtection(master.protection).label, /Weaker protection/);
  assert.match(credentialProtection(master.protection).detail, /can decrypt/);
  assert.equal(credentialProtection("os-keychain").label, "OS keychain");
});
