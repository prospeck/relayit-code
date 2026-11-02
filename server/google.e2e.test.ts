import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";

let fixture: VerificationServer;
let scripts: string;
let scriptDir: string;
const call = (name: string, input: unknown) => ({ server: "google", name, input });
const api = async (method: string, path: string, body?: unknown, status = 200) => {
  const response = await fetch(fixture.info.url + path, { method, headers: { "content-type": "application/json", origin: fixture.info.url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
  const value = await response.json() as any;
  expect(response.status, `${method} ${path}`).toBe(status);
  return value;
};
beforeAll(async () => {
  scriptDir = mkdtempSync(join(tmpdir(), "relayit-google-scripts-"));
  scripts = join(scriptDir, "calls.json");
  writeFileSync(scripts, "[]");
  fixture = await launchVerificationServer({ FAKE_CLAUDE_TOOL_CALLS_FILE: scripts, FAKE_CLAUDE_REPLY: "Fixture Google turn complete." });
}, 40_000);
afterAll(async () => { await fixture?.close(); if (scriptDir) rmSync(scriptDir, { recursive: true, force: true }); });

it("connects the demo through real settings routes, mounts Google for a bot, drafts without a card, and holds sending and Calendar changes", async () => {
  expect(await api("GET", "/api/google")).toMatchObject({ connected: false, mode: "none" });
  expect(await api("POST", "/api/google/connect", { fake: true })).toMatchObject({ connected: true, mode: "fake", issues: [] });
  const { bot } = await api("POST", "/api/bots", { name: "Direct Google fixture" }, 201);
  const messages = async () => (await api("GET", `/api/threads/${bot.threadId}/messages?limit=200`)).messages as any[];
  const turn = async (calls: unknown[], text: string) => {
    writeFileSync(scripts, JSON.stringify(calls));
    await api("POST", `/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text }, 202);
  };
  const idle = () => expect.poll(async () => (await api("GET", "/api/bots")).bots.find((candidate: any) => candidate.id === bot.id)?.busy, { timeout: 20_000, interval: 100 }).toBe(false);
  await turn([
    call("gmail_search", { query: "in:inbox", max: 2 }),
    call("gmail_draft_reply", { threadId: "thread-1", body: "A synthetic draft reply." }),
    call("calendar_list_events", { range: "week" }),
  ], "Read demo mail and draft a reply.");
  await idle();
  const drafted = await messages();
  expect(drafted.some((message) => message.card?.requestId)).toBe(false);
  const dump = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8"));
  expect(dump.mcpConfig.mcpServers.google).toBeTruthy();
  const results = drafted.filter((message) => message.kind === "activity");
  expect(results.some((message) => message.tool?.name === "gmail_draft_reply" && message.tool?.ok)).toBe(true);

  await turn([call("gmail_send", { to: "fixture@example.test", subject: "Synthetic send", body: "Only sends after approval." })], "Send a fixture message.");
  await expect.poll(async () => (await messages()).find((message) => message.card?.outboundRequest && !message.card?.answered), { timeout: 15_000, interval: 100 }).toBeTruthy();
  const sendCard = (await messages()).find((message) => message.card?.outboundRequest && !message.card?.answered);
  expect(sendCard.card.tool).toBe("gmail_send");
  await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: sendCard.card.requestId, behavior: "allow" });
  await idle();
  expect((await messages()).some((message) => message.tool?.name === "gmail_send" && message.tool?.ok)).toBe(true);

  await turn([call("calendar_create_event", { summary: "Synthetic calendar event", start: { date: "2026-11-03" }, end: { date: "2026-11-04" } })], "Create a fixture calendar event.");
  await expect.poll(async () => (await messages()).find((message) => message.card?.tool === "calendar_create_event" && !message.card?.answered), { timeout: 15_000, interval: 100 }).toBeTruthy();
  const calendarCard = (await messages()).find((message) => message.card?.tool === "calendar_create_event" && !message.card?.answered);
  await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: calendarCard.card.requestId, behavior: "deny" });
  await idle();
  expect(await api("DELETE", "/api/google")).toMatchObject({ connected: false, mode: "none" });
}, 60_000);
