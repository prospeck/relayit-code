import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { McpOAuthStore, mcpOAuthFiles, removeMcpOAuthFile } from "./mcp-oauth-store.ts";

const URL_A = "https://mcp.example.com/mcp";
let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcp-oauth-store-"));
  file = join(dir, "mcp-oauth.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("McpOAuthStore", () => {
  it("migrates plaintext tokens and removes the original only after encryption", () => {
    const record = { url: URL_A, state: "signed-in", tokens: { access: "fixture-access-private", refresh: "fixture-refresh-private" } };
    writeFileSync(file, JSON.stringify({ servers: { docs: record } }));
    expect(new McpOAuthStore(file).get("docs", URL_A)).toEqual(record);
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(join(dir, ".credentials/mcp-oauth.enc")).includes(Buffer.from("fixture-access-private"))).toBe(false);
  });

  it("keeps people isolated across migration, discovery, restart and deletion", () => {
    const alice = join(dir, "alice.json"), bob = join(dir, "bob.json");
    writeFileSync(alice, JSON.stringify({ servers: { docs: { url: URL_A, state: "signed-in", tokens: { access: "fixture-alice-private" } } } }));
    new McpOAuthStore(bob).put("docs", { url: URL_A, state: "signed-in", tokens: { access: "fixture-bob-private" } });
    expect(new McpOAuthStore(alice).get("docs", URL_A)?.tokens?.access).toBe("fixture-alice-private");
    expect(new McpOAuthStore(bob).get("docs", URL_A)?.tokens?.access).toBe("fixture-bob-private");
    expect(mcpOAuthFiles(dir).sort()).toEqual(["alice.json", "bob.json"]);
    removeMcpOAuthFile(alice);
    expect(mcpOAuthFiles(dir)).toEqual(["bob.json"]);
    expect(new McpOAuthStore(bob).get("docs", URL_A)?.tokens?.access).toBe("fixture-bob-private");
  });

  it("writes an owner-only file and reads a record back", () => {
    const store = new McpOAuthStore(file);
    store.put("docs", { url: URL_A, state: "signed-in", clientId: "c1", tokens: { access: "at", refresh: "rt", expiresAt: 5 } });
    // Windows has no POSIX permission bits; stat reports 0o666 there.
    if (process.platform !== "win32") expect(statSync(join(dir, ".credentials/mcp-oauth.enc")).mode & 0o777).toBe(0o600);
    expect(new McpOAuthStore(file).get("docs", URL_A)).toEqual({ url: URL_A, state: "signed-in", clientId: "c1", tokens: { access: "at", refresh: "rt", expiresAt: 5 } });
  });

  it("does not hand a record to a different URL", () => {
    const store = new McpOAuthStore(file);
    store.put("docs", { url: URL_A, state: "signed-in", tokens: { access: "at" } });
    expect(store.get("docs", "https://evil.example.com/mcp")).toBeUndefined();
  });

  it("deletes a record", () => {
    const store = new McpOAuthStore(file);
    store.put("docs", { url: URL_A, state: "needs-sign-in" });
    store.delete("docs");
    expect(store.get("docs", URL_A)).toBeUndefined();
  });

  it("refuses to overwrite corrupt original credentials", () => {
    writeFileSync(file, "{not json", { mode: 0o600 });
    const store = new McpOAuthStore(file);
    expect(() => store.get("docs", URL_A)).toThrow("Credential storage could not be opened");
    expect(() => store.put("docs", { url: URL_A, state: "needs-sign-in" })).toThrow();
    expect(readFileSync(file, "utf8")).toBe("{not json");
  });
});
