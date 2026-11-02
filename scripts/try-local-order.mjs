#!/usr/bin/env node
// Runs one message through the real server and a real local Ollama model, and prints what the model was sent and what
// the bot did. Everything runs under a throwaway home and data folder, so no real data or sign-in is touched.
//
//   node scripts/try-local-order.mjs ["Order something from California Pizza"] [limit-seconds] [model] [--approve | --deny]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
const approve = flags.has("--approve");
const deny = flags.has("--deny");
if (approve && deny) throw new Error("Choose --approve or --deny");
const [prompt = "Order something from California Pizza", limit = "300", model = "qwen3:4b-instruct"] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const OLLAMA = "http://127.0.0.1:11434";
const freePort = async () => {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
};
const PORT = await freePort();
const WEBHOOK = await freePort();
const PROXY = await freePort();

const home = mkdtempSync(join(tmpdir(), "relayit-try-"));
const data = join(home, "data");
mkdirSync(data);
const copies = new Set();
const aliases = new Map();
const copyPrefix = `relayit-try-${home.split("-").at(-1).toLowerCase()}-`;
const wire = [];

const proxy = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (req.url.includes("chat/completions")) {
    const body = JSON.parse(raw);
    wire.push(body);
    const chars = body.messages.reduce((n, m) => n + JSON.stringify(m.content ?? "").length, 0);
    const tools = (body.tools ?? []).map((tool) => tool.function?.name);
    console.log(`[wire] model=${body.model} stream=${Boolean(body.stream)} ~tokens=${Math.round((chars + JSON.stringify(body.tools ?? []).length) / 4)} tools=${tools.join(",")}`);
  }
  let created;
  if (raw) {
    const body = JSON.parse(raw);
    if (req.url === "/api/create" && /^relayit-/.test(body.model)) {
      created = `${copyPrefix}${body.model.slice("relayit-".length)}`;
      aliases.set(body.model, created);
      body.model = created;
    } else if (aliases.has(body.model)) body.model = aliases.get(body.model);
    raw = JSON.stringify(body);
  }
  const up = await fetch(`${OLLAMA}${req.url}`, {
    method: req.method,
    headers: { "content-type": "application/json" },
    ...(req.method === "GET" ? {} : { body: raw }),
  });
  if (created && up.ok) copies.add(created);
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
    OMB_WEBHOOK_PORT: String(WEBHOOK),
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

process.on("SIGINT", () => { void finish(130); });
process.on("SIGTERM", () => { void finish(143); });
process.on("uncaughtException", (error) => { console.error(error.message); void finish(1); });
process.on("unhandledRejection", (error) => { console.error(String(error)); void finish(1); });

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

const stages = {};
const start = Date.now();
const stage = (name) => { if (!(name in stages)) { stages[name] = Math.round((Date.now() - start) / 1000); console.log(`[stage] ${name} +${stages[name]}s`); } };
const unwrapped = (output) => {
  try {
    let value = JSON.parse(output);
    for (let i = 0; i < 8; i++) {
      if (typeof value === "string") value = JSON.parse(value);
      else if (value?.result !== undefined) value = value.result;
      else return value;
    }
  } catch {}
};
let checkoutDone = false;
let checkoutPayment;
let settlementSent = false;
let denialAtRequest;
const answered = new Set();
let orderCardApproved = false;
const elapsed = () => `+${Math.round((Date.now() - start) / 1000)}s`;
await api(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: `${prompt}\nMock data only. Use delivery address Home, 12 Demo Road, Bengaluru.` }) });

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
    if (m.card?.tool && !m.card.answered) stage("approval_card");
    if (m.tool?.ok) {
      const full = m.tool.clipped || m.tool.fullResult ? (await api(`/api/threads/${bot.threadId}/messages/${m.id}/tool`)).body?.output : undefined;
      const output = unwrapped(full ?? m.tool.output);
      if (m.tool.name.endsWith("place_order")) stage("place_order");
      if (output?.status === "awaiting_payment") stage("awaiting_payment");
      if (output?.type === "payment") {
        stage("payments_create_request");
        if (output.upiUri) stage("payment_card_payload");
        if (approve && !checkoutDone && output.checkoutUrl) {
          const url = new URL(output.checkoutUrl);
          if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !/^\/(?:api\/india\/mock-checkout\/)?pay\/plink_[a-f0-9]+$/.test(url.pathname)) throw new Error("Not a local mock checkout");
          const paid = await fetch(`${url.href}/complete`, { method: "POST" });
          if (!paid.ok) throw new Error(`Mock checkout failed: ${paid.status}`);
          checkoutDone = true;
          checkoutPayment = output;
          stage("mock_checkout");
        }
      }
      if (["confirmed", "preparing", "out_for_delivery", "delivered"].includes(output?.status)) stage("order_confirmed");
    }
    const parts = [m.role, m.kind, m.tool?.name, m.card?.title, m.card?.subtitle, (m.text ?? "").replace(/\s+/g, " ").slice(0, 300)];
    console.log(`${elapsed()} ${parts.filter(Boolean).join(" | ")}`.slice(0, 460));
  }
  if (messages.some((m) => m.card && !m.card.answered)) {
    const card = messages.find((m) => m.card?.requestId && m.card.tool && !m.card.answered && !answered.has(m.card.requestId))?.card;
    if (card?.requestType === "question") {
      stage("unanswered_question");
      console.log(`${elapsed()} WAITING ON A QUESTION; --approve does not invent answers`);
      break;
    }
    if (card && (approve || deny)) {
      const duplicateOrder = approve && card.tool.endsWith("place_order") && orderCardApproved;
      const behavior = deny || duplicateOrder ? "deny" : "allow";
      if (duplicateOrder) stage("duplicate_order_refused");
      if (behavior === "allow" && card.tool.endsWith("place_order")) orderCardApproved = true;
      if (deny) denialAtRequest = wire.length;
      const response = await api(`/api/threads/${bot.threadId}/respond`, { method: "POST", body: JSON.stringify({ requestId: card.requestId, behavior }) });
      console.log(`${elapsed()} HTTP card ${behavior}: ${response.status} ${JSON.stringify(response.body)}`);
      if (response.status >= 300) throw new Error("Card response failed");
      answered.add(card.requestId);
      stage(behavior === "deny" ? "denied" : "approved");
    } else if (!approve && !deny) {
      console.log(`${elapsed()} WAITING ON A CARD`);
      break;
    }
  }
  const bots = (await api("/api/bots")).body;
  const busy = (bots?.bots ?? (Array.isArray(bots) ? bots : [])).find((b) => b.id === bot.id)?.busy;
  if (busy === false) {
    if (checkoutDone && !settlementSent && !stages.order_confirmed) {
      settlementSent = true;
      await api(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: `I completed the local mock checkout for order ${checkoutPayment.orderId}, payment ${checkoutPayment.id}. Call payments_check_status with that paymentId and get_order_status with that orderId now.` }) });
      quietSince = null;
      continue;
    }
    quietSince ??= Date.now();
    if (Date.now() - quietSince > 12_000) {
      console.log(`${elapsed()} TURN ENDED`);
      break;
    }
  } else quietSince = null;
}

const stateFile = join(data, "india-services", "food", "food-state.json");
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { orders: {} };
const orders = Object.values(state.orders);
console.log("[result]", JSON.stringify({ stages, seconds: Math.round((Date.now() - start) / 1000), orders: orders.map(({ status, amountInr }) => ({ status, amountInr })), requests: wire.length, requestsWithTools: wire.filter((request) => request.tools?.length).length, requestsAfterDenial: denialAtRequest === undefined ? undefined : wire.slice(denialAtRequest).filter((request) => request.tools?.length).length }));
if (deny && orders.length) throw new Error("Denial placed an order");
if (deny && denialAtRequest !== undefined && wire.slice(denialAtRequest).some((request) => request.tools?.length)) throw new Error("The model ran again after denial");
const main = [...wire].sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
if (main) writeFileSync(join(tmpdir(), "relayit-try-system.txt"), String(main.messages.find((m) => m.role === "system")?.content ?? ""));
const loaded = await (await fetch(`${OLLAMA}/api/ps`)).json();
console.log("ollama loaded:", JSON.stringify(loaded.models.map((m) => [m.name, m.context_length])));
console.log("problems in the server log:", log.split("\n").filter((line) => /\berror\b|TypeError|refus/i.test(line)).slice(-6).join("\n").slice(0, 800) || "none");
await finish(0);
