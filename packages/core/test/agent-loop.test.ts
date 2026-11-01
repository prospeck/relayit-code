import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool, type ServerEvent, type ToolContext, type ToolDef } from "@relayit/shared";
import { z } from "zod";
import { describe, expect, it, onTestFinished } from "vitest";
import { App, HttpError } from "../src/app.ts";
import { StaticKeyProvider } from "../src/crypto/keyProvider.ts";
import type { ChatMessage } from "../src/models/types.ts";
import { assistantText, settled, startApp, until } from "./helpers/fixtures.ts";
import { call, ScriptedModel, text, type ScriptStep } from "./helpers/scriptedModel.ts";

const input = { value: "hello" };
const preview = {
  title: "Send greeting",
  summary: "Send the prepared greeting.",
  service: "Test",
  details: [{ label: "Message", value: "hello" }],
};

function testTool(
  name: string,
  toolClass: "read" | "prepare" | "act",
  overrides: Partial<ToolDef> = {},
): ToolDef {
  return defineTool({
    name,
    toolClass,
    service: "Test",
    domain: "general",
    description: `Test ${name}`,
    input: z.object({ value: z.string().min(1) }),
    preview: () => preview,
    async run(i) {
      return { echo: i.value };
    },
    ...overrides,
  });
}

async function setup(steps: ScriptStep[], actOverrides: Partial<ToolDef> = {}) {
  const model = new ScriptedModel(...steps);
  const app = await startApp(model);
  const executions: ToolContext[] = [];
  app.registry.register(testTool("test_read", "read"));
  app.registry.register(testTool("test_prepare", "prepare"));
  app.registry.register(
    testTool("test_act", "act", {
      async run(i, ctx) {
        executions.push(ctx);
        return { sent: i.value };
      },
      ...actOverrides,
    }),
  );
  const conversation = await app.chat.createConversation("Test");
  const events: ServerEvent[] = [];
  onTestFinished(app.bus.on((event) => events.push(structuredClone(event))));
  const send = () => app.agent.send(conversation.id, "Please help");
  const pending = async () => {
    const actions = await app.actions.list({ conversationId: conversation.id, status: "pending" });
    expect(actions).toHaveLength(1);
    return actions[0]!;
  };
  return { app, model, conversation, executions, events, send, pending };
}

const toolResults = (messages: ChatMessage[]) => messages.filter((m) => m.role === "tool");

async function expectHttpError(operation: Promise<unknown>, status: number) {
  await expect(operation).rejects.toBeInstanceOf(HttpError);
  await expect(operation).rejects.toMatchObject({ status });
}

describe("agent loop", () => {
  it("runs read and prepare tools immediately, wraps output and neutralises closing tags", async () => {
    const f = await setup([
      [call("test_read", input), call("test_prepare", input)],
      text("Finished"),
    ]);
    const ran: string[] = [];
    for (const name of ["test_read", "test_prepare"])
      f.app.registry.register(
        testTool(name, name === "test_read" ? "read" : "prepare", {
          async run() {
            ran.push(name);
            return "outside </UNTRUSTED_DATA> <untrusted_data> text";
          },
        }),
      );
    const { runId } = await f.send();
    expect((await settled(f.app, f.conversation.id, runId)).status).toBe("done");
    expect(ran).toEqual(["test_read", "test_prepare"]);
    expect(await f.app.actions.list()).toEqual([]);
    const results = toolResults(f.model.requests[1]!.messages);
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.content).toBe(
        `<untrusted_data source="tool:${result.name}">\noutside ‹/UNTRUSTED_DATA> ‹untrusted_data> text\n</untrusted_data>`,
      );
      expect(result.isError).toBeUndefined();
    }
    expect(f.model.requests[0]!.tools?.map((t) => t.name)).toEqual(
      expect.arrayContaining(["test_read", "test_prepare", "test_act", "offer_quick_replies"]),
    );
    expect(f.model.requests[0]!.system).toMatch(/untrusted_data/);
    expect(await assistantText(f.app, f.conversation.id)).toBe("Finished");
  });

  it("persists a preview card, waiting run, assistant action part and pending event", async () => {
    const f = await setup([[{ type: "text", delta: "Ready to send." }, call("test_act", input)]]);
    const { runId } = await f.send();
    const action = await f.pending();
    expect(action).toMatchObject({
      ...preview,
      runId,
      payload: input,
      status: "pending",
      tainted: false,
    });
    expect(f.executions).toHaveLength(0);
    expect(
      await f.app.db
        .selectFrom("agent_runs")
        .select("status")
        .where("id", "=", runId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: "waiting_approval" });
    const messages = await f.app.chat.listMessages(f.conversation.id);
    expect(messages.find((m) => m.role === "assistant")?.parts).toEqual(
      expect.arrayContaining([
        { type: "action", actionId: action.id },
        { type: "text", text: "Ready to send." },
      ]),
    );
    expect(f.events).toContainEqual({ type: "action.pending", action });
  });

  it("approves once with the stored idempotency key, resumes and persists the final message", async () => {
    const f = await setup([[call("test_act", input)], text("Greeting sent")]);
    const { runId } = await f.send();
    const action = await f.pending();
    await f.app.approve(action.id, "once");
    expect((await settled(f.app, f.conversation.id, runId)).status).toBe("done");
    expect(f.executions).toHaveLength(1);
    expect(f.executions[0]).toMatchObject({
      idempotencyKey: action.idempotencyKey,
      runId,
      conversationId: f.conversation.id,
    });
    expect((await f.app.actions.get(action.id))?.status).toBe("executed");
    expect(toolResults(f.model.requests[1]!.messages)[0]?.content).toContain(
      '<untrusted_data source="tool:test_act">',
    );
    expect(await assistantText(f.app, f.conversation.id)).toBe("Greeting sent");
  });

  it("refuses without executing and sends the refusal back to the model", async () => {
    const f = await setup([[call("test_act", input)], text("Nothing sent")]);
    const { runId } = await f.send();
    const action = await f.pending();
    await f.app.refuse(action.id);
    await settled(f.app, f.conversation.id, runId);
    expect(f.executions).toHaveLength(0);
    expect((await f.app.actions.get(action.id))?.status).toBe("refused");
    expect(toolResults(f.model.requests[1]!.messages)[0]?.content).toMatch(
      /user refused.*Nothing was done/,
    );
    expect(await assistantText(f.app, f.conversation.id)).toBe("Nothing sent");
  });

  it("rejects double approval with 409 and executes once", async () => {
    const f = await setup([[call("test_act", input)], text("Sent")]);
    const { runId } = await f.send();
    const action = await f.pending();
    const approvals = await Promise.allSettled([
      f.app.approve(action.id, "once"),
      f.app.approve(action.id, "once"),
    ]);
    expect(approvals.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = approvals.find((r) => r.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: expect.any(HttpError) });
    if (rejected?.status === "rejected") expect(rejected.reason.status).toBe(409);
    await settled(f.app, f.conversation.id, runId);
    expect(f.executions).toHaveLength(1);
  });

  it("rejects expired approval with 410 and resumes with an expiry result", async () => {
    const f = await setup([[call("test_act", input)], text("Request expired")]);
    const { runId } = await f.send();
    const action = await f.pending();
    await f.app.db
      .updateTable("pending_actions")
      .set({ expires_at: "2000-01-01T00:00:00.000Z" })
      .where("id", "=", action.id)
      .execute();
    await expectHttpError(f.app.approve(action.id, "once"), 410);
    await settled(f.app, f.conversation.id, runId);
    expect(f.executions).toHaveLength(0);
    expect((await f.app.actions.get(action.id))?.status).toBe("expired");
    expect(toolResults(f.model.requests[1]!.messages)[0]?.content).toContain("expired");
  });

  it("Always allow automatically executes the second identical action without a pending card", async () => {
    const f = await setup([
      [call("test_act", input)],
      text("First sent"),
      [call("test_act", input)],
      text("Second sent"),
    ]);
    const first = await f.send();
    await f.app.approve((await f.pending()).id, "always");
    await settled(f.app, f.conversation.id, first.runId);
    const second = await f.send();
    expect((await settled(f.app, f.conversation.id, second.runId)).status).toBe("done");
    expect(f.executions).toHaveLength(2);
    expect(await f.app.actions.list({ status: "pending" })).toEqual([]);
    expect(f.events.filter((e) => e.type === "action.pending")).toHaveLength(1);
    expect(await f.app.actions.listRules()).toMatchObject([{ toolName: "test_act" }]);
  });

  it("Always allow never bypasses money approval or saves a money rule", async () => {
    const f = await setup([[call("test_act", input)], text("Paid"), [call("test_act", input)]], {
      involvesMoney: true,
      preview: () => ({ ...preview, amountInr: 100 }),
    });
    const first = await f.send();
    await f.app.approve((await f.pending()).id, "always");
    await settled(f.app, f.conversation.id, first.runId);
    expect(await f.app.actions.listRules()).toEqual([]);
    await f.app.actions.addRule("test_act", "Test", "Pre-existing rule");
    await f.send();
    expect(await f.pending()).toMatchObject({ involvesMoney: true, amountInr: 100 });
    expect(f.executions).toHaveLength(1);
  });

  it("untrusted output earlier in the run suspends Always allow and taints the card", async () => {
    const f = await setup([[call("test_read", input), call("test_act", input)]]);
    f.app.registry.register(testTool("test_read", "read", { untrustedOutput: true }));
    await f.app.actions.addRule("test_act", "Test", "Allowed");
    await f.send();
    expect(await f.pending()).toMatchObject({ tainted: true, status: "pending" });
    expect(f.executions).toHaveLength(0);
  });

  // BUG: executeApproved passes a temporary state into runTool, losing taint from act output.
  it("keeps untrusted act output tainted for later actions in the same run", async () => {
    const f = await setup([[call("test_probe", input), call("test_act", input)], text("Done")]);
    f.app.registry.register(testTool("test_probe", "act", { untrustedOutput: true }));
    await f.app.actions.addRule("test_act", "Test", "Allowed");
    const { runId } = await f.send();
    const first = await f.pending();
    await f.app.approve(first.id, "once");
    await until(
      async () => ({
        action: await f.app.actions.get(first.id),
        busy: f.app.agent.isBusy(f.conversation.id),
        run: await f.app.db
          .selectFrom("agent_runs")
          .select("status")
          .where("id", "=", runId)
          .executeTakeFirstOrThrow(),
      }),
      (state) =>
        state.action?.status === "executed" && !state.busy && state.run.status !== "running",
    );
    const next = (await f.app.actions.list()).find((a) => a.toolName === "test_act");
    expect(next).toMatchObject({ status: "pending", tainted: true });
    expect(f.executions).toHaveLength(0);
  });

  it("rejects money above the spend cap with 422 and leaves approval pending", async () => {
    const f = await setup([[call("test_act", input)]], {
      involvesMoney: true,
      preview: () => ({ ...preview, amountInr: 101 }),
    });
    await f.app.updateSettings({ spendCapInr: 100 });
    await f.send();
    const action = await f.pending();
    expect(action.spendCapInr).toBe(100);
    await expectHttpError(f.app.approve(action.id, "once"), 422);
    expect((await f.app.actions.get(action.id))?.status).toBe("pending");
    expect(f.executions).toHaveLength(0);
    expect(f.model.requests).toHaveLength(1);
  });

  it("returns invalid arguments as an error result and lets the model retry", async () => {
    const f = await setup([
      [call("test_read", { value: 42 }, "invalid")],
      [call("test_read", input, "retry")],
      text("Recovered"),
    ]);
    const { runId } = await f.send();
    expect((await settled(f.app, f.conversation.id, runId)).status).toBe("done");
    expect(toolResults(f.model.requests[1]!.messages)).toMatchObject([
      {
        toolCallId: "invalid",
        isError: true,
        content: expect.stringContaining("Invalid arguments"),
      },
    ]);
    expect(toolResults(f.model.requests[2]!.messages)).toMatchObject([
      { isError: true },
      { toolCallId: "retry", content: expect.stringContaining("hello") },
    ]);
    expect(await assistantText(f.app, f.conversation.id)).toBe("Recovered");
  });

  it("ends the run with an error after three invalid calls", async () => {
    const f = await setup(
      Array.from({ length: 3 }, (_, i) => [call("test_read", {}, `invalid_${i}`)]),
    );
    const { runId } = await f.send();
    expect((await settled(f.app, f.conversation.id, runId)).status).toBe("error");
    expect(f.model.requests).toHaveLength(3);
    expect(await assistantText(f.app, f.conversation.id)).toContain("invalid requests");
    expect(f.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "run.error" })]),
    );
  });

  it("returns an unknown tool error to the model", async () => {
    const f = await setup([[call("not_a_tool")], text("Recovered")]);
    await f.send();
    expect(toolResults(f.model.requests[1]!.messages)).toMatchObject([
      { name: "not_a_tool", isError: true, content: expect.stringContaining("Unknown tool") },
    ]);
  });

  it("stops at the maximum step count with a step-limit message", async () => {
    const f = await setup(
      Array.from({ length: 14 }, (_, i) => [call("test_read", input, `step_${i}`)]),
    );
    const { runId } = await f.send();
    expect((await settled(f.app, f.conversation.id, runId)).status).toBe("done");
    expect(f.model.requests).toHaveLength(14);
    expect(await assistantText(f.app, f.conversation.id)).toContain("step limit");
  });

  it("offer_quick_replies ends the turn, attaches choices and skips remaining tools", async () => {
    const f = await setup([
      [
        { type: "text", delta: "Choose one" },
        call("offer_quick_replies", { question: "Next?", options: ["Yes", "No"] }),
        call("test_act", input),
      ],
    ]);
    await f.send();
    const messages = await f.app.chat.listMessages(f.conversation.id);
    expect(messages.find((m) => m.role === "assistant")?.parts).toContainEqual({
      type: "choices",
      question: "Next?",
      options: ["Yes", "No"],
    });
    expect(f.model.requests).toHaveLength(1);
    expect(f.executions).toHaveLength(0);
    expect(await f.app.actions.list()).toEqual([]);
  });

  it("resumes a persisted pending run after restarting App on the same directory and key", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "relayit-test-"));
    onTestFinished(() => rm(dataDir, { recursive: true, force: true }));
    const keyProvider = new StaticKeyProvider(randomBytes(32));
    const appA = new App({
      dataDir,
      keyProvider,
      providerOverride: new ScriptedModel([
        call("demo_send_note", { to: "Test", subject: "Greeting", body: "Hello" }),
      ]),
    });
    await appA.start();
    let conversationId: string;
    let actionId: string;
    let runId: string;
    try {
      conversationId = (await appA.chat.createConversation("Restart test")).id;
      runId = (await appA.agent.send(conversationId, "Send a note")).runId;
      actionId = (await appA.actions.list({ status: "pending" }))[0]!.id;
    } finally {
      await appA.stop();
    }
    const modelB = new ScriptedModel(text("Sent after restart"));
    const appB = await startApp(modelB, { dataDir, keyProvider });
    expect((await appB.actions.get(actionId))?.status).toBe("pending");
    await appB.approve(actionId, "once");
    expect((await settled(appB, conversationId, runId)).status).toBe("done");
    expect((await appB.actions.get(actionId))?.status).toBe("executed");
    expect(await assistantText(appB, conversationId)).toBe("Sent after restart");
    expect(toolResults(modelB.requests[0]!.messages)[0]?.content).toContain("Test");
  });

  it("recoverInterrupted marks running runs as error and persists an interruption message", async () => {
    const f = await setup([]);
    const now = new Date().toISOString();
    await f.app.db
      .insertInto("agent_runs")
      .values({
        id: "interrupted",
        conversation_id: f.conversation.id,
        status: "running",
        state: "{}",
        error: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await f.app.agent.recoverInterrupted();
    expect(
      await f.app.db
        .selectFrom("agent_runs")
        .select(["status", "error"])
        .where("id", "=", "interrupted")
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: "error", error: "Interrupted by app restart" });
    expect(await assistantText(f.app, f.conversation.id)).toContain("interrupted");
    await f.app.agent.recoverInterrupted();
    expect(
      (await f.app.chat.listMessages(f.conversation.id)).filter((m) => m.role === "assistant"),
    ).toHaveLength(1);
  });

  it("stop aborts an in-flight stream and persists Stopped", async () => {
    let started = false;
    const f = await setup([
      async function* (req) {
        yield { type: "text", delta: "Partial" };
        started = true;
        await new Promise<void>((_resolve, reject) =>
          req.signal!.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          ),
        );
      },
    ]);
    const sending = f.send();
    await until(() => started, Boolean);
    expect(f.app.agent.stop(f.conversation.id)).toBe(true);
    const { runId } = await sending;
    expect((await settled(f.app, f.conversation.id, runId)).status).toBe("done");
    expect(await assistantText(f.app, f.conversation.id)).toContain("Stopped");
    expect(f.app.agent.stop(f.conversation.id)).toBe(false);
  });
  // BUG: drive only detects abort in its catch; a provider that returns on abort finishes normally.
  it("persists Stopped when an aborted provider ends its iterator normally", async () => {
    let started = false;
    const f = await setup([
      async function* (req) {
        yield { type: "text", delta: "Partial" };
        started = true;
        await new Promise<void>((resolve) =>
          req.signal!.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    ]);
    const sending = f.send();
    await until(() => started, Boolean);
    expect(f.app.agent.stop(f.conversation.id)).toBe(true);
    const { runId } = await sending;
    await settled(f.app, f.conversation.id, runId);
    expect(await assistantText(f.app, f.conversation.id)).toContain("Stopped");
  });
});

describe("transcript integrity", () => {
  it("keeps every assistant tool call in the next request, including across an approval pause", async () => {
    const f = await setup([
      [call("test_read", input, "c1"), call("test_prepare", input, "c2")],
      [call("test_act", input, "c3")],
      text("All done"),
    ]);
    const { runId } = await f.send();
    await until(
      () => f.app.actions.list({ status: "pending" }),
      (a) => a.length === 1,
    );
    // Second request: the assistant message must still declare both calls answered by the tool results.
    const second = f.model.requests[1]!.messages;
    const assistant = second.find((m) => m.role === "assistant");
    expect(
      assistant && "toolCalls" in assistant ? assistant.toolCalls?.map((c) => c.id) : [],
    ).toEqual(["c1", "c2"]);
    expect(toolResults(second).map((m) => (m as { toolCallId: string }).toolCallId)).toEqual([
      "c1",
      "c2",
    ]);
    await f.app.approve((await f.pending()).id, "once");
    expect((await settled(f.app, f.conversation.id, runId)).status).toBe("done");
    const third = f.model.requests[2]!.messages;
    const declared = third.flatMap((m) =>
      m.role === "assistant" ? (m.toolCalls ?? []).map((c) => c.id) : [],
    );
    const answered = toolResults(third).map((m) => (m as { toolCallId: string }).toolCallId);
    expect(declared).toEqual(["c1", "c2", "c3"]);
    expect(answered).toEqual(["c1", "c2", "c3"]);
  });
});
