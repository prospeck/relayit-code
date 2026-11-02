import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";

let fixture: VerificationServer;
let voice: Server;
let rejectVoice = false;
const secrets = ["fixture-http-tts-private", "fixture-http-fish-private", "fixture-http-mcp-private", "fixture-http-header-private", "fixture-http-login-private", "fixture-http-rejected-private"];
beforeAll(async () => {
  voice = createServer((req, res) => {
    res.writeHead(rejectVoice ? 429 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(rejectVoice ? { message: `Provider echoed ${req.headers["xi-api-key"]}` } : { voices: [] }));
  });
  await new Promise<void>(resolve => voice.listen(0, "127.0.0.1", resolve));
  const port = (voice.address() as { port: number }).port;
  fixture = await launchVerificationServer({ OMB_ELEVENLABS_API: `http://127.0.0.1:${port}` });
}, 60_000);
afterAll(async () => { await fixture?.close(); if (voice) await new Promise<void>(resolve => voice.close(() => resolve())); });

async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(`${fixture.info.url}${path}`, {
    method, headers: { "content-type": "application/json", origin: fixture.info.url },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json() as { savedKeys: { ttsKey: { configured: boolean } }; credentialStorage: { protection: string; label: string }; error?: string };
  for (const secret of secrets) expect(JSON.stringify(result)).not.toContain(secret);
  return { status: response.status, body: result };
}

it("keeps config, MCP and login APIs write-only with encrypted disk files and no secrets in fixture logs", async () => {
  const saved = await api("PATCH", "/api/config", { tts: { key: secrets[0] } });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  expect(saved.body.savedKeys.ttsKey).toEqual({ configured: true });
  expect(saved.body.credentialStorage).toMatchObject({ protection: "key-file", label: "Weaker protection: local key file" });
  expect((await api("POST", "/api/mcp/servers", { name: "secret_fixture", command: process.execPath, args: ["--version"], env: { ANY_NAME: secrets[2] } })).status).toBe(201);
  expect((await api("POST", "/api/mcp/servers", { name: "remote_fixture", type: "http", url: "http://127.0.0.1:9/mcp", headers: { "X-Access": secrets[3] } })).status).toBe(201);
  expect((await api("POST", "/api/logins", { site: "accounts.example.test", username: "fixture", password: secrets[4], bots: "all" })).status).toBe(201);
  await api("GET", "/api/config");
  await api("GET", "/api/mcp/servers");
  await api("GET", "/api/logins");
  rejectVoice = true;
  const rejected = await api("PATCH", "/api/config", { tts: { key: secrets[5] } });
  expect(rejected.status).toBe(400);
  expect(rejected.body.error).toContain("••••••");
  const disk = readFileSync(join(fixture.info.dataDir, "config.json"), "utf8");
  const logs = readFileSync(fixture.info.logPath, "utf8");
  const decisionsDir = join(fixture.info.dataDir, "decisions");
  const decisions = existsSync(decisionsDir) ? readdirSync(decisionsDir).map(file => readFileSync(join(decisionsDir, file), "utf8")).join("\n") : "";
  for (const secret of secrets) {
    expect(disk).not.toContain(secret);
    expect(logs).not.toContain(secret);
    expect(decisions).not.toContain(secret);
  }
  for (const name of ["config", "logins"]) expect(existsSync(join(fixture.info.dataDir, ".credentials", `${name}.enc`))).toBe(true);
  expect((await api("PATCH", "/api/config", { tts: { key: "", fishKey: "" } })).body.savedKeys.ttsKey).toEqual({ configured: false });
}, 30_000);
