import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { App, StaticKeyProvider, buildApi, loadPlugins } from "@relayit/core";
import { ProviderId, type Message } from "@relayit/shared";
import { scenarios, type Scenario } from "./scenarios.ts";
import { pickReply, score, toolSequence, type Check, type Evidence, type Phase } from "./score.ts";

const TIMEOUT_MS = 10 * 60_000;
process.env.TZ = "Asia/Kolkata";
const resultsDir = fileURLToPath(new URL("./results/", import.meta.url));
const { values: flags } = parseArgs({ options: {
  model: { type: "string", default: "qwen3:4b" }, provider: { type: "string", default: "ollama" },
  "base-url": { type: "string" }, only: { type: "string" }, repeat: { type: "string", default: "1" },
  resume: { type: "string" },
  help: { type: "boolean", default: false },
}, strict: true });

if (flags.help) {
  console.log("pnpm evals [--model qwen3:4b] [--provider ollama] [--base-url http://127.0.0.1:11434] [--only food-restaurant] [--repeat 3] [--resume results/<checkpoint>.json]");
  process.exit(0);
}
const provider = ProviderId.parse(flags.provider);
const model = flags.model;
const repeat = Number(flags.repeat);
if (!Number.isSafeInteger(repeat) || repeat < 1) throw new Error("--repeat must be a positive integer");
const selected = flags.only ? scenarios.filter(s => s.id === flags.only) : scenarios;
if (!selected.length) throw new Error(`Unknown --only id: ${flags.only}. Choose: ${scenarios.map(s => s.id).join(", ")}`);
const defaults = {
  ollama: "http://127.0.0.1:11434/v1", anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1", gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  openrouter: "https://openrouter.ai/api/v1",
};
let baseUrl = (flags["base-url"] ?? defaults[provider]).replace(/\/$/, "");
if (provider === "ollama" && !baseUrl.endsWith("/v1")) baseUrl += "/v1";
const keyEnv = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY", openrouter: "OPENROUTER_API_KEY", ollama: "" };
const apiKey = provider === "ollama" ? undefined : process.env[keyEnv[provider]];
if (provider !== "ollama" && !apiKey) throw new Error(`${keyEnv[provider]} is required for --provider ${provider}`);

// Keep the default run offline even if the model hallucinates a web-fetch tool call.
// An explicitly selected remote provider may contact only that provider's origin.
const originalFetch = globalThis.fetch;
const blockedRequests: string[] = [];
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  const allowedProvider = provider !== "ollama" && url.origin === new URL(baseUrl).origin;
  if (!local && !allowedProvider) {
    blockedRequests.push(url.origin);
    throw new Error(`Eval offline policy blocked ${url.origin}`);
  }
  return originalFetch(input, init);
};

type RunSnapshot = { id: string; status: string; error: string | null; state: {
  step: number; domains: string[] | "all"; usage: { inputTokens: number; outputTokens: number };
  messages: { role: string; content: string; name?: string; isError?: boolean; toolCalls?: unknown[] }[];
} };
export type Result = Evidence & {
  id: string; prompt: string; iteration: number; passed: boolean; checks: Check[];
  wallTimeMs: number; intentWallTimeMs: number | null; tokens: { input: number; output: number };
  tools: string[]; questions: number; runs: RunSnapshot[];
  finalAssistantText: string;
  replies: { options: string[]; match: string; selected: string }[];
  expected: Scenario["expectations"];
};

async function waitUntil(predicate: () => boolean | Promise<boolean>, deadline: number, label: string): Promise<void> {
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`);
    await delay(50);
  }
}

async function evaluate(s: Scenario, iteration: number): Promise<Result> {
  const dataDir = await mkdtemp(join(tmpdir(), "relayit-eval-"));
  const app = new App({ dataDir, keyProvider: new StaticKeyProvider(randomBytes(32)), fakeGoogleUrl: "auto", timeZone: "Asia/Kolkata" });
  const evidence: Evidence = { audit: [], cards: [], texts: [], links: [], memory: [], routines: [], steps: 0, errors: [], choiceMisses: [], refusalRetries: [], startedAt: new Date().toISOString() };
  let conversationId = "";
  let phase: Phase = "intent";
  let started = Date.now();
  let deadline = started + TIMEOUT_MS;
  let intentWallTimeMs: number | null = null;
  const replies: Result["replies"] = [];
  const runs = new Map<string, RunSnapshot>();
  const intentSteps = new Map<string, number>();
  const seenMessages = new Set<string>();
  const blockedBefore = blockedRequests.length;
  let pendingSend: Promise<unknown> | undefined;
  const unsubscribe = app.bus.on(event => {
    if (event.type === "run.step" && event.conversationId === conversationId && ["running", "waiting"].includes(event.step.status)) console.log(`  ${phase}: ${event.step.tool} ${event.step.status}`);
    if (event.type === "audit" && event.event.conversationId === conversationId && conversationId) evidence.audit.push(event.event);
    if (event.type === "message.created" && event.message.conversationId === conversationId) recordMessage(event.message);
    if (event.type === "action.pending" && event.action.conversationId === conversationId) {
      const card = { ...event.action, phase, auditIndex: evidence.audit.length - 1 };
      if (phase === "refusal" && evidence.cards.some(c => c.toolName === card.toolName && JSON.stringify(c.payload) === JSON.stringify(card.payload))) evidence.refusalRetries.push(card.toolName);
      evidence.cards.push(card);
    }
  });
  function recordMessage(message: Message) {
    if (seenMessages.has(message.id)) return;
    seenMessages.add(message.id);
    if (message.role !== "assistant") return;
    for (const part of message.parts) {
      if (part.type === "text") evidence.texts.push({ text: part.text, phase });
      if (part.type === "link") evidence.links.push({ url: part.url, title: part.title });
    }
  }
  async function snapshot() {
    const rows = await app.db.selectFrom("agent_runs").select(["id", "status", "error", "state"]).where("conversation_id", "=", conversationId).orderBy("created_at").execute();
    for (const row of rows) {
      const run: RunSnapshot = { ...row, state: JSON.parse(row.state) };
      runs.set(row.id, run);
      if (phase !== "refusal" && !intentSteps.has(row.id)) intentSteps.set(row.id, run.state.step);
    }
    for (const message of await app.chat.listMessages(conversationId)) recordMessage(message);
  }
  async function bounded(operation: Promise<unknown>) {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { app.agent.stop(conversationId); reject(new Error("Scenario exceeded 10 minute deadline")); }, Math.max(1, deadline - Date.now()));
      })]);
    } finally { clearTimeout(timer); }
    await snapshot();
  }
  async function send(text: string) {
    pendingSend = app.agent.send(conversationId, text);
    await bounded(pendingSend);
  }
  async function chooseUntilCard() {
    let followUp = 0;
    while (!(await app.actions.list({ conversationId, status: "pending" })).length) {
      const messages = await app.chat.listMessages(conversationId);
      const last = messages.filter(m => m.role === "assistant").at(-1);
      const choice = last?.parts.find(p => p.type === "choices");
      if (!choice || choice.type !== "choices") return;
      const match = s.followUps?.[followUp++]?.match;
      const selectedReply = match ? pickReply(choice.options, match) : undefined;
      if (!match || !selectedReply) {
        evidence.choiceMisses.push(`No scripted regex matched ${JSON.stringify(choice.options)}${match ? ` using /${match}/i` : "; follow-ups exhausted"}`);
        return;
      }
      replies.push({ options: choice.options, match, selected: selectedReply });
      await send(selectedReply);
    }
  }
  async function refuseAll() {
    // Refusing resumes the original run and may reveal the second intent's card.
    for (let count = 0; count < 6; count++) {
      const pending = await app.actions.list({ conversationId, status: "pending" });
      if (!pending.length) return;
      phase = "refusal";
      for (const card of pending) {
        await app.refuse(card.id);
        // resume() reads storage before marking itself busy; allow that microtask to start.
        await delay(10);
        await bounded(waitUntil(() => !app.agent.isBusy(conversationId), deadline, "refusal continuation"));
      }
    }
    throw new Error("Agent kept creating approval cards after six refusals");
  }
  try {
    await app.start();
    await app.updateSettings({ briefOnFirstOpen: false, notifications: false, browserAgentEnabled: false, briefTime: "23:59" });
    await app.kv.set("brief.last", { date: new Date().toDateString(), conversationId: "eval-suppressed", createdAt: new Date().toISOString() });
    const modules = await loadPlugins(app);
    await waitUntil(() => !!app.registry.get("place_order") && !!app.registry.get("cab_handoff"), Date.now() + 15_000, "built-in MCP tools");
    // Let automatic startup triage finish before setting a model: it uses its real heuristic fallback,
    // avoiding an unrelated background LLM request competing with this sequential eval.
    await waitUntil(async () => (await app.audit.list({ kind: "tool.result" })).some(a => a.toolName === "gmail_triage"), Date.now() + 15_000, "startup fake-inbox triage");
    const api = buildApi(app, "eval-local", modules);
    const response = await api.request("/api/onboarding", {
      method: "POST", headers: { authorization: "Bearer eval-local", "content-type": "application/json" },
      body: JSON.stringify({ profile: { name: "Aarav", city: "Bengaluru", addresses: [
        { id: "home", label: "Home", line: "12 Eval Lane, Indiranagar", city: "Bengaluru", pincode: "560038" },
        { id: "work", label: "Work", line: "24 Eval Park, Whitefield", city: "Bengaluru", pincode: "560066" },
      ] }, model: { provider, model, baseUrl }, ...(apiKey ? { apiKey } : {}) }),
    });
    if (!response.ok) throw new Error(`Onboarding failed (${response.status}); check provider configuration`);
    for (const fact of [
      { category: "order" as const, key: "usual pizza order", value: "One BBQ Chicken Pizza from California Pizza Kitchen, no extras" },
      { category: "preference" as const, key: "veg preference", value: "false; I eat chicken and other non-vegetarian food" },
      { category: "travel" as const, key: "train seat preference", value: "lower berth, 3A" },
      { category: "person" as const, key: "manager", value: "Kavya Rao, kavya.rao@greenpath.example.com" },
    ]) await app.memory.upsert(fact, "user");
    const conv = await app.chat.createConversation("New chat");
    conversationId = conv.id;
    started = Date.now(); deadline = started + TIMEOUT_MS;
    evidence.startedAt = new Date(started).toISOString();
    console.log(`[${s.id} #${iteration}] ${s.prompt}`);
    await send(s.prompt);
    await chooseUntilCard();
    intentWallTimeMs = Date.now() - started;
    await refuseAll();
    if (s.afterRefusal && evidence.cards.length) {
      phase = "changed_mind";
      await send(s.afterRefusal);
      await chooseUntilCard();
      await refuseAll();
    }
  } catch (error) {
    evidence.errors.push(app.redactor.text(error instanceof Error ? error.message : String(error)));
    app.agent?.stop(conversationId);
    await pendingSend?.catch(() => {});
    if (conversationId) await snapshot();
  } finally {
    if (conversationId) {
      app.agent.stop(conversationId);
      await waitUntil(() => !app.agent.isBusy(conversationId), Date.now() + 5000, "stopping scenario").catch(e => evidence.errors.push(String(e)));
      // At deadline, refuse remaining cards directly without launching more inference.
      for (const card of await app.actions.list({ conversationId, status: "pending" })) {
        await app.actions.transition(card.id, "pending", "refused");
        await app.audit.log({ kind: "action.refused", summary: `Eval cleanup refused: ${card.title}`, toolName: card.toolName, toolClass: "act", conversationId });
      }
      for (const card of evidence.cards) card.status = (await app.actions.get(card.id))!.status;
      evidence.memory = await app.memory.list();
      evidence.routines = await app.routines.list();
      await snapshot();
    }
    unsubscribe();
    await app.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
  evidence.errors.push(...blockedRequests.slice(blockedBefore).map(origin => `Blocked network attempt: ${origin}`));
  evidence.errors.push(...[...runs.values()].flatMap(r => r.error ? [r.error] : []));
  evidence.steps = [...intentSteps.values()].reduce((a, b) => a + b, 0);
  const tokens = [...runs.values()].reduce((sum, r) => ({ input: sum.input + r.state.usage.inputTokens, output: sum.output + r.state.usage.outputTokens }), { input: 0, output: 0 });
  const checks = score(s, { ...evidence, runs: [...runs.values()], replies });
  const result: Result = { ...evidence, id: s.id, prompt: s.prompt, iteration, checks, passed: checks.every(c => c.pass), wallTimeMs: Date.now() - started, intentWallTimeMs,
    tokens, tools: toolSequence(evidence), questions: evidence.audit.filter(a => a.kind === "tool.call" && a.toolName === "offer_quick_replies").length,
    finalAssistantText: evidence.texts.at(-1)?.text ?? "", runs: [...runs.values()], replies, expected: s.expectations };
  console.log(`[${s.id} #${iteration}] ${result.passed ? "PASS" : "FAIL"} ${(result.wallTimeMs / 1000).toFixed(1)}s; failed: ${checks.filter(c => !c.pass).map(c => c.name).join(", ") || "none"}`);
  // Scrub raw provider errors/transcripts too, while preserving numeric token usage.
  return JSON.parse(JSON.stringify(result, (_key, value) => typeof value === "string" ? app.redactor.text(value) : value)) as Result;
}

type Checkpoint = {
  startedAt: string; resumedAt?: string[];
  configuration: { provider: string; model: string; baseUrl: string; repeat: number; only: string | null };
  results: Result[];
};
const resumePath = flags.resume ? resolve(flags.resume) : null;
if (resumePath && dirname(resumePath) !== resolve(resultsDir)) throw new Error("--resume must name a JSON file inside evals/results/");
const checkpoint: Checkpoint | null = resumePath ? JSON.parse(await readFile(resumePath, "utf8")) : null;
if (checkpoint) {
  const expected = { provider, model, baseUrl, repeat, only: flags.only ?? null };
  for (const [key, value] of Object.entries(expected)) {
    if (checkpoint.configuration[key as keyof typeof expected] !== value) throw new Error(`--resume configuration differs: ${key}`);
  }
  const seen = new Set<string>();
  for (const result of checkpoint.results) {
    const scenario = selected.find(s => s.id === result.id);
    const key = `${result.id}:${result.iteration}`;
    if (!scenario || result.prompt !== scenario.prompt || result.iteration < 1 || result.iteration > repeat || seen.has(key)) throw new Error(`Invalid checkpoint attempt: ${key}`);
    seen.add(key);
  }
}
const startedAt = checkpoint?.startedAt ?? new Date().toISOString();
const resumedAt = checkpoint ? [...(checkpoint.resumedAt ?? []), new Date().toISOString()] : [];
const filename = resumePath ? basename(resumePath) : `${startedAt.replace(/[:.]/g, "-")}-${model.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
const results: Result[] = checkpoint?.results ?? [];
async function save(complete: boolean) {
  const passed = results.filter(r => r.passed).length;
  const report = { version: 1, startedAt, resumedAt, updatedAt: new Date().toISOString(), complete,
    configuration: { provider, model, baseUrl, repeat, only: flags.only ?? null, timeoutMs: TIMEOUT_MS, node: process.version, timeZone: "Asia/Kolkata", approvals: "always refuse", fakeGoogle: true, startupTriage: "heuristic before onboarding", browser: "disabled", tokens: "provider usage in persisted runs; interrupted partial requests may be unreported" },
    summary: { passed, total: results.length, planned: selected.length * repeat, passRate: results.length ? passed / results.length : 0,
      scenarios: selected.map(s => { const attempts = results.filter(r => r.id === s.id); const n = attempts.filter(r => r.passed).length;
        return { id: s.id, passed: n, total: attempts.length, passRate: attempts.length ? n / attempts.length : null, flaky: n > 0 && n < attempts.length }; }) }, results };
  await mkdir(resultsDir, { recursive: true });
  const target = join(resultsDir, filename);
  await writeFile(`${target}.tmp`, JSON.stringify(report, null, 2) + "\n");
  await rename(`${target}.tmp`, target);
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const rows = results.map(r => `| ${r.id} #${r.iteration} | ${r.passed ? "PASS" : "FAIL"} | ${r.checks.map(c => `${c.pass ? "✓" : "✗"} ${cell(c.name)}`).join("<br>")} | ${r.tools.join(" → ") || "—"} | ${(r.wallTimeMs / 1000).toFixed(1)}s | ${r.tokens.input}/${r.tokens.output} |`);
  await writeFile(join(resultsDir, "latest.md"), `# Intent understanding eval\n\n${model} via ${provider}; ${startedAt}. ${complete ? "Complete" : "In progress"}.\n\n${passed}/${results.length} passed (${(report.summary.passRate * 100).toFixed(1)}%); ${report.summary.planned} planned.\n\n[Full evidence](${filename})\n\n| Scenario | Result | Checks | Tools (executions + approval requests) | Wall time | Tokens in/out |\n| --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n\nEach run has fresh storage and a fresh conversation. All cards are refused. Time includes refusal continuations; the JSON also records time to the first endpoint. Steps exclude refusal-only inference. Success-claim scoring is lexical, so read the transcript when interpreting it. Tool errors fail even if later recovered. No repeated run means no measured flakiness.\n`);
}

async function main() {
  if (provider === "ollama") {
    try {
      const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const models = await response.json() as { data?: { id: string }[] };
      if (!models.data?.some(m => m.id === model)) throw new Error(`Model ${model} is not installed`);
    } catch (error) {
      console.error(`Ollama is unavailable at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}. Start Ollama and install ${model} before running evals.`);
      process.exitCode = 2;
      return;
    }
  }
  await save(false);
  for (let iteration = 1; iteration <= repeat; iteration++) for (const scenario of selected) {
    if (results.some(r => r.id === scenario.id && r.iteration === iteration)) continue;
    results.push(await evaluate(scenario, iteration));
    await save(false);
  }
  await save(true);
  console.log(`Results: ${join(resultsDir, filename)}; ${results.filter(r => r.passed).length}/${results.length} passed.`);
  process.exitCode = results.every(r => r.passed) ? 0 : 1;
}

await main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; });
