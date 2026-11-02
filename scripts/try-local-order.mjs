#!/usr/bin/env node
// Runs one message through the real server and a real local Ollama model, and prints what the model was sent and what
// the bot did. Everything runs under a throwaway home and data folder, so no real data or sign-in is touched.
//
//   node scripts/try-local-order.mjs ["Order something from California Pizza"] [limit-seconds] [model]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const [prompt = "Order something from California Pizza", limit = "300", model = "qwen3:4b-instruct"] = process.argv.slice(2);
const OLLAMA = "http://127.0.0.1:11434";
const PORT = 28799;
const PROXY = 28812;

const home = mkdtempSync(join(tmpdir(), "relayit-try-"));
const data = join(home, "data");
mkdirSync(data);
const copies = new Set();
const wire = [];

const proxy = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (req.url.includes("chat/completions")) {
    const body = JSON.parse(raw);
    wire.push(body);
    if (/^relayit-/.test(body.model)) copies.add(body.model);
    const chars = body.messages.reduce((n, m) => n + JSON.stringify(m.content ?? "").length, 0);
    const tools = (body.tools ?? []).map((tool) => tool.function?.name);
    console.log(`[wire] model=${body.model} stream=${Boolean(body.stream)} ~tokens=${Math.round((chars + JSON.stringify(body.tools ?? []).length) / 4)} tools=${tools.join(",")}`);
  }
  const up = await fetch(`${OLLAMA}${req.url}`, {
    method: req.method,
    headers: { "content-type": "application/json" },
    ...(req.method === "GET" ? {} : { body: raw }),
  });
  res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/json" });
  if (up.body) for await (const chunk of up.body) res.write(chunk);
  res.end();
}).listen(PROXY, "127.0.0.1");

writeFileSync(join(data, "config.json"), JSON.stringify({
  instances: {
    local: {
      driver: "openai-compat",
      displayName: "Local",
      environment: { K: "ollama" },
      config: { url: `http://127.0.0.1:${PROXY}/v1`, apiKeyEnv: "K", model, replyWaitMinutes: 8 },
    },
  },
}));

const server = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "server/dev-server.ts"], {
  cwd: repo,
  env: {
    PATH: process.env.PATH,
    HOME: home,
    OMB_DATA_DIR: data,
    OMB_PORT: String(PORT),
    OMB_WEBHOOK_PORT: String(PORT + 1),
    NODE_OPTIONS: "--max-old-space-size=1500",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (d) => { log += d; });
server.stderr.on("data", (d) => { log += d; });

const api = async (path, init) => {
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`, { ...init, headers: { "content-type": "application/json" } });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function finish(code) {
  server.kill("SIGKILL");
  proxy.close();
  for (const name of copies) {
    await fetch(`${OLLAMA}/api/generate`, { method: "POST", body: JSON.stringify({ model: name, keep_alive: 0 }) }).catch(() => {});
    await fetch(`${OLLAMA}/api/delete`, { method: "DELETE", body: JSON.stringify({ model: name }) }).catch(() => {});
  }
  rmSync(home, { recursive: true, force: true });
  process.exit(code);
}

const bootBy = Date.now() + 240_000;
let up = false;
while (Date.now() < bootBy && !up) {
  try {
    up = (await api("/api/config")).status < 500;
  } catch { /* still starting */ }
  if (!up) await sleep(1500);
}
if (!up) {
  console.log(`server did not start:\n${log.slice(-1500)}`);
  await finish(1);
}

for (const id of ["food", "travel", "payments"]) {
  const added = await api(`/api/mcp/builtins/${id}`, { method: "POST", body: "{}" });
  console.log("add", id, added.status);
}
for (const name of ["india-food", "india-travel", "india-payments"]) {
  const tested = await api(`/api/mcp/servers/${name}/test`, { method: "POST", body: "{}" });
  const enabled = await api(`/api/mcp/servers/${name}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
  console.log("test", name, tested.status, JSON.stringify(tested.body).slice(0, 110), "enable", enabled.status);
}
const servers = (await api("/api/mcp/servers")).body?.servers ?? [];
console.log("servers:", servers.map((s) => `${s.name}:${s.enabled ? "on" : "off"}`).join(" "));

const created = await api("/api/bots", { method: "POST", body: JSON.stringify({ name: "Relay", provider: "local", model, driver: "openai-compat" }) });
const bot = created.body?.bot;
if (!bot) {
  console.log("could not create the bot:", created.status, JSON.stringify(created.body).slice(0, 300));
  await finish(1);
}
console.log("bot", created.status, "approval:", bot.approvalMode ?? "(default)");

const start = Date.now();
const elapsed = () => `+${Math.round((Date.now() - start) / 1000)}s`;
await api(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: prompt }) });

const seen = new Set();
let quietSince = null;
while (Date.now() - start < Number(limit) * 1000) {
  await sleep(4000);
  const page = (await api(`/api/threads/${bot.threadId}/messages`)).body;
  const messages = page?.messages ?? page?.items ?? (Array.isArray(page) ? page : []);
  for (const m of messages) {
    const key = `${m.id}:${m.kind ?? ""}:${(m.text ?? "").length}:${m.card?.answered ?? ""}:${m.tool?.ok ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const parts = [m.role, m.kind, m.tool?.name, m.card?.title, m.card?.subtitle, (m.text ?? "").replace(/\s+/g, " ").slice(0, 300)];
    console.log(`${elapsed()} ${parts.filter(Boolean).join(" | ")}`.slice(0, 460));
  }
  if (messages.some((m) => m.card && !m.card.answered)) {
    console.log(`${elapsed()} WAITING ON A CARD`);
    break;
  }
  const bots = (await api("/api/bots")).body;
  const busy = (bots?.bots ?? (Array.isArray(bots) ? bots : [])).find((b) => b.id === bot.id)?.busy;
  if (busy === false) {
    quietSince ??= Date.now();
    if (Date.now() - quietSince > 12_000) {
      console.log(`${elapsed()} TURN ENDED`);
      break;
    }
  } else quietSince = null;
}

const main = [...wire].sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
if (main) writeFileSync(join(tmpdir(), "relayit-try-system.txt"), String(main.messages.find((m) => m.role === "system")?.content ?? ""));
const loaded = await (await fetch(`${OLLAMA}/api/ps`)).json();
console.log("ollama loaded:", JSON.stringify(loaded.models.map((m) => [m.name, m.context_length])));
console.log("problems in the server log:", log.split("\n").filter((line) => /\berror\b|TypeError|refus/i.test(line)).slice(-6).join("\n").slice(0, 800) || "none");
await finish(0);
