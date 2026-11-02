import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EncryptedCredentialStore } from "../electron/credential-store.mjs";
import { hydrateConfigCredentials, persistConfigCredentials, readConfigCredentials } from "./config-credentials.ts";
import { credentialStore, credentialStorageStatus, CredentialDocument } from "./credential-store.ts";
import { redactSecrets, redactSecretsInText } from "./redact.ts";
import { keyStatus, nestedKeyStatus } from "./key-hint.ts";
import { listMcpServers } from "./mcp-registry.ts";
import { appendDecision, decisionFileFor, flushDecisionLog } from "./decision-log.ts";
import type { JsonObject } from "./schema.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "relayit-config-secrets-")); });
afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { force: true, recursive: true }); });
const config: JsonObject = {
  openai: { key: "fixture-provider-private", model: "keep model" },
  tts: { key: "fixture-tts-private", fishKey: "fixture-fish-private" },
  box: { token: "fixture-boat-private" },
  composio: { apiKey: "fixture-composio-private" },
  opencodeGo: { providerKeys: { VENICE_API_KEY: "fixture-venice-private" } },
  instances: { custom: { driver: "openai-compat", environment: { CUSTOM_CREDENTIAL: "fixture-env-private" }, config: { key: "fixture-instance-private", url: "https://example.test/v1" } } },
  mcpServers: {
    remote: { type: "http", url: "https://example.test/mcp", headers: { "X-Access": "fixture-header-private" }, oauth: { clientId: "fixture-client-id", clientSecret: "fixture-client-private" } },
    local: { command: "node", args: ["app.mjs"], env: { ANY_NAME: "fixture-mcp-env-private" } },
  },
};
const secrets = ["provider", "tts", "fish", "boat", "composio", "venice", "env", "instance", "header", "client", "mcp-env"].map(name => `fixture-${name}-private`);

describe("configuration credential migration", () => {
  it("migrates plaintext on read, preserves configuration and keeps secret values off disk", () => {
    writeFileSync(join(dir, "config.json"), JSON.stringify(config));
    expect(readConfigCredentials(dir)).toEqual(config);
    expect(readConfigCredentials(dir)).toEqual(config);
    const disk = readFileSync(join(dir, "config.json"), "utf8");
    const encrypted = readFileSync(join(dir, ".credentials/config.enc"));
    for (const secret of secrets) {
      expect(disk).not.toContain(secret);
      expect(encrypted.includes(Buffer.from(secret))).toBe(false);
    }
    expect(disk).toContain("https://example.test/mcp");
    expect(disk).toContain("keep model");
    expect(credentialStorageStatus(dir).label).toContain("Weaker protection");
  });

  it("clears and rotates credentials without reviving old references", () => {
    persistConfigCredentials(dir, config);
    persistConfigCredentials(dir, { openai: { key: "" }, tts: { key: "fixture-rotated-private" } });
    expect(readConfigCredentials(dir)).toEqual({ openai: { key: "" }, tts: { key: "fixture-rotated-private" } });
    if (process.platform !== "win32") {
      const saved = JSON.stringify(credentialStore(dir).read("config"));
      expect(saved).not.toContain("fixture-provider-private");
      expect(saved).not.toContain("fixture-tts-private");
    }
  });

  it("preserves provider login-folder metadata for backup validation", () => {
    const path = join(dir, "workspaces", "unsafe-login-home");
    persistConfigCredentials(dir, { instances: { custom: { environment: { HOME: path, CUSTOM_CREDENTIAL: "fixture-private-env" } } } });
    const disk = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    expect(disk.instances.custom.environment.HOME).toBe(path);
    expect(disk.instances.custom.environment.CUSTOM_CREDENTIAL).not.toBe("fixture-private-env");
  });

  it("preserves plaintext when the encrypted write fails", () => {
    const original = JSON.stringify(config);
    writeFileSync(join(dir, "config.json"), original);
    vi.spyOn(EncryptedCredentialStore.prototype, "write").mockImplementationOnce(() => { throw new Error("simulated disk failure"); });
    expect(() => readConfigCredentials(dir)).toThrow("simulated disk failure");
    expect(readFileSync(join(dir, "config.json"), "utf8")).toBe(original);
    expect(readConfigCredentials(dir)).toEqual(config);
  });

  it("resumes a simulated crash after encrypted commit but before config replacement", () => {
    writeFileSync(join(dir, "config.json"), JSON.stringify(config));
    const original = EncryptedCredentialStore.prototype.write;
    vi.spyOn(EncryptedCredentialStore.prototype, "write").mockImplementationOnce(function (this: EncryptedCredentialStore, name, value) {
      original.call(this, name, value);
      throw new Error("simulated crash after encryption");
    });
    expect(() => readConfigCredentials(dir)).toThrow("simulated crash");
    expect(readFileSync(join(dir, "config.json"), "utf8")).toContain(secrets[0]);
    expect(existsSync(join(dir, ".credentials/config.enc"))).toBe(true);
    expect(readConfigCredentials(dir)).toEqual(config);
    expect(readFileSync(join(dir, "config.json"), "utf8")).not.toContain(secrets[0]);
  });

  it("cannot turn a copied reference into a public profile value", () => {
    persistConfigCredentials(dir, config);
    const disk = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    disk.profile = { name: disk.openai.key };
    expect(() => hydrateConfigCredentials(dir, disk)).toThrow("Credential storage could not be opened");
  });

  it("rejects missing keys and damaged data instead of returning defaults", () => {
    persistConfigCredentials(dir, config);
    const ciphertext = join(dir, ".credentials/config.enc");
    writeFileSync(ciphertext, "damaged");
    expect(() => readConfigCredentials(dir)).toThrow("Credential storage could not be opened");
    expect(() => persistConfigCredentials(dir, {})).toThrow();
    expect(readFileSync(ciphertext, "utf8")).toBe("damaged");
  });

  it("redacts arbitrary stored values in log text and decision rows; API summaries stay write-only", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    persistConfigCredentials(dir, config);
    readConfigCredentials(dir);
    const summaries = JSON.stringify({ provider: keyStatus(secrets[0]), nested: nestedKeyStatus({ tts: { key: secrets[1] } }), mcp: listMcpServers(config.mcpServers as Record<string, unknown>) });
    const decision = JSON.stringify(redactSecrets({ tool: "fixture", input: { prose: secrets.join(" ") } }));
    const text = redactSecretsInText(secrets.join(" "));
    const logs = JSON.stringify([...warn.mock.calls, ...log.mock.calls, ...error.mock.calls]);
    for (const secret of secrets) {
      expect(summaries).not.toContain(secret);
      expect(decision).not.toContain(secret);
      expect(text).not.toContain(secret);
      expect(logs).not.toContain(secret);
    }
    expect(keyStatus(secrets[0])).toEqual({ configured: true });
  });

  it("redacts stored credentials before the decision log reaches disk", async () => {
    persistConfigCredentials(dir, config);
    appendDecision(dir, { threadId: "fixture", tool: "fixture", summary: secrets.join(" "), decision: "user-approved", source: "user" });
    await flushDecisionLog(dir);
    const log = readFileSync(decisionFileFor(dir, new Date()), "utf8");
    for (const secret of secrets) expect(log).not.toContain(secret);
    expect(log).toContain("••••••");
  });

  it("failed plaintext cleanup can retry from the authenticated copy", () => {
    const file = join(dir, "oauth.json");
    writeFileSync(file, '{"token":"fixture-migration-private"}');
    const document = new CredentialDocument(dir, "oauth", { file }, value => value as { token: string });
    // A nonempty directory makes removal fail after the encrypted write is confirmed.
    const store = credentialStore(dir);
    const value = { token: "fixture-migration-private" };
    store.write("oauth", value);
    rmSync(file);
    mkdirSync(file);
    writeFileSync(join(file, "block"), "fixture");
    expect(() => document.read()).toThrow();
    expect(store.read("oauth")).toEqual(value);
    rmSync(file, { recursive: true });
    expect(document.read()).toEqual(value);
  });
});
