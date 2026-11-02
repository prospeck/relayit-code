import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { GoogleSecrets } from "./google/store.ts";
import { HighLevelStore } from "./highlevel/store.ts";
import { credentialStore } from "./credential-store.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "relayit-credential-migration-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function legacy(name: string, value: unknown): void {
  const key = randomBytes(32).toString("hex");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(key).digest(), nonce);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  writeFileSync(join(dir, `${name}-key`), key, { mode: 0o600 });
  writeFileSync(join(dir, `${name}.json.enc`), Buffer.concat([nonce, body, cipher.getAuthTag()]), { mode: 0o600 });
}

it("migrates Google and HighLevel adjacent-key files, preserves secrets and removes legacy key material", async () => {
  legacy("google", { version: 1, values: { "google.client.secret": "fixture-google-private" } });
  legacy("highlevel", { version: 1, connection: { kind: "token", accessToken: "fixture-highlevel-private", locationId: "fixture-location", connectedAt: 1, state: "signed-in" } });
  expect(await new GoogleSecrets(dir).get("google.client.secret")).toBe("fixture-google-private");
  expect(new HighLevelStore({ dataDir: dir }).get()?.accessToken).toBe("fixture-highlevel-private");
  for (const name of ["google", "highlevel"]) {
    expect(existsSync(join(dir, `${name}-key`))).toBe(false);
    expect(existsSync(join(dir, `${name}.json.enc`))).toBe(false);
    expect(readFileSync(credentialStore(dir).path(name)).includes(Buffer.from(`fixture-${name}-private`))).toBe(false);
  }
});

it("keeps both legacy files when their key is invalid and refuses a replacement", async () => {
  legacy("google", { version: 1, values: { "google.client.secret": "fixture-google-private" } });
  const file = join(dir, "google.json.enc"), original = readFileSync(file);
  writeFileSync(join(dir, "google-key"), "invalid");
  await expect(new GoogleSecrets(dir).set("google.client.secret", "replacement")).rejects.toThrow("Credential storage could not be opened");
  expect(readFileSync(file)).toEqual(original);
  expect(existsSync(join(dir, "google-key"))).toBe(true);
  expect(existsSync(credentialStore(dir).path("google"))).toBe(false);
});

it("receives the desktop key on a fake private parent channel without losing startup messages", () => {
  const script = `
    import assert from "node:assert/strict";
    import { EventEmitter } from "node:events";
    const port = new EventEmitter();
    process.parentPort = port;
    let requests = 0;
    port.postMessage = message => {
      assert.equal(message.type, "openmausbot:credential-master-request");
      assert.ok(port.listenerCount("message") >= 2);
      requests++;
      setImmediate(() => {
        port.emit("message", { data: { type: "openmausbot:credential-master", dataDir: process.env.OMB_DATA_DIR, master: { key: "a".repeat(64), protection: "os-keychain" } } });
        port.emit("message", { data: { type: "fixture-startup-message" } });
      });
    };
    const imported = import(${JSON.stringify(new URL("./credential-store.ts", import.meta.url).href)});
    const module = await imported;
    assert.equal(requests, 1);
    const messages = [];
    module.listenDesktopPrivateMessages(event => messages.push(event.data.type));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(messages, ["fixture-startup-message"]);
    assert.equal(module.credentialStorageStatus(process.env.OMB_DATA_DIR).protection, "os-keychain");
    assert.throws(() => module.credentialStorageStatus(process.env.OMB_DATA_DIR + "/../outside"));
    module.credentialStore(process.env.OMB_DATA_DIR).write("fixture", { secret: "fixture-channel-private" });
    assert.deepEqual(module.credentialStore(process.env.OMB_DATA_DIR).read("fixture"), { secret: "fixture-channel-private" });
    console.log("private channel passed");
  `;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    env: { OMB_DATA_DIR: dir, OMB_DESKTOP_PARENT: "1", NODE_OPTIONS: "--max-old-space-size=1500" }, encoding: "utf8", timeout: 10_000,
  });
  expect(result.stderr).not.toContain("fixture-channel-private");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe("private channel passed");
  expect(existsSync(join(dir, ".credentials/master-key"))).toBe(false);
});
