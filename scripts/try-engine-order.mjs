#!/usr/bin/env node
// Runs one message through the real server on an agent app you're signed in to (Claude or Codex), and denies the first
// approval card, so nothing is placed. The data folder is throwaway. HOME stays real because that's where the app's
// sign-in lives, so this spends a little of that account's usage.
//
//   node scripts/try-engine-order.mjs <instanceId> <model> ["message"] [limit-seconds]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const [instanceId, model, prompt = "Order something from California Pizza", limit = "300"] = process.argv.slice(2);
if (!instanceId || !model) throw new Error("Usage: try-engine-order.mjs <instanceId> <model> [message] [limit-seconds]");

const freePort = () => new Promise((resolve) => {
  const probe = createServer().listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});
const port = await freePort();
const data = mkdtempSync(join(tmpdir(), "relayit-engine-"));
writeFileSync(join(data, "config.json"), "{}");

const server = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "server/dev-server.ts"], {
  cwd: repo,
  env: {
    PATH: `${join(homedir(), ".t3/bin")}:${process.env.PATH}`,
    HOME: homedir(),
    // The Mac keychain, where these apps keep their sign-ins, needs to know whose it is.
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME,
    TMPDIR: process.env.TMPDIR,
    OMB_DATA_DIR: data,
    OMB_PORT: String(port),
    OMB_WEBHOOK_PORT: String(await freePort()),
    NODE_OPTIONS: "--max-old-space-size=1500",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (d) => { log += d; });
server.stderr.on("data", (d) => { log += d; });

const api = async (path, init) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { "content-type": "application/json" } });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const finish = (code) => {
  server.kill("SIGKILL");
  rmSync(data, { recursive: true, force: true });
  process.exit(code);
};

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
  finish(1);
}

await sleep(6000);
const instances = (await api("/api/instances")).body;
const list = instances?.instances ?? (Array.isArray(instances) ? instances : []);
const chosen = list.find((i) => (i.instanceId ?? i.id) === instanceId);
if (!chosen) {
  console.log(`no engine called ${instanceId}. There's: ${list.map((i) => i.instanceId ?? i.id).join(" ")}`);
  finish(1);
}
console.log("engine:", JSON.stringify(chosen).slice(0, 500));

for (const id of ["food", "payments"]) await api(`/api/mcp/builtins/${id}`, { method: "POST", body: "{}" });
for (const name of ["india-food", "india-payments"]) {
  await api(`/api/mcp/servers/${name}/test`, { method: "POST", body: "{}" });
  await api(`/api/mcp/servers/${name}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
}

const created = await api("/api/bots", { method: "POST", body: JSON.stringify({ name: "Relay", modelSelection: { instanceId, model } }) });
const bot = created.body?.bot;
if (!bot) {
  console.log("could not create the bot:", created.status, JSON.stringify(created.body).slice(0, 400));
  finish(1);
}
console.log("bot", created.status, "approval:", bot.approvalMode ?? "(default)", "model:", JSON.stringify(bot.modelSelection));

const start = Date.now();
const elapsed = () => `+${Math.round((Date.now() - start) / 1000)}s`;
const sent = await api(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: prompt }) });
console.log("send", sent.status, sent.status >= 300 ? JSON.stringify(sent.body).slice(0, 300) : "");
if (sent.status >= 300) finish(1);

const seen = new Set();
let quietSince = null;
let denied = false;
while (Date.now() - start < Number(limit) * 1000) {
  await sleep(3000);
  const page = (await api(`/api/threads/${bot.threadId}/messages`)).body;
  const messages = page?.messages ?? page?.items ?? (Array.isArray(page) ? page : []);
  for (const m of messages) {
    const key = `${m.id}:${m.kind ?? ""}:${(m.text ?? "").length}:${m.card?.answered ?? ""}:${m.tool?.ok ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const parts = [m.role, m.kind, m.tool?.name, m.card?.title, typeof m.card?.subtitle === "string" ? m.card.subtitle.replace(/\s+/g, " ").slice(0, 220) : "", (m.text ?? "").replace(/\s+/g, " ").slice(0, 260)];
    console.log(`${elapsed()} ${parts.filter(Boolean).join(" | ")}`.slice(0, 520));
  }
  const card = messages.find((m) => m.card && !m.card.answered && m.card.requestId);
  if (card && !denied) {
    denied = true;
    console.log(`${elapsed()} CARD for tool ${card.card.tool}: ${String(card.card.subtitle ?? "").slice(0, 500)}`);
    const answer = await api(`/api/threads/${bot.threadId}/respond`, { method: "POST", body: JSON.stringify({ requestId: card.card.requestId, behavior: "deny" }) });
    console.log(`${elapsed()} DENIED the card:`, answer.status, JSON.stringify(answer.body).slice(0, 160));
    continue;
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
console.log("problems in the server log:", log.split("\n").filter((line) => /\berror\b|TypeError|refus/i.test(line)).slice(-8).join("\n").slice(0, 900) || "none");
finish(0);
