import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import type {
  AppState,
  AuditEvent,
  Conversation,
  Message,
  PendingAction,
  ServerEvent,
} from "@relayit/shared";
import { describe, expect, it, onTestFinished } from "vitest";
import { App } from "../src/app.ts";
import { startServer } from "../src/api/server.ts";
import { StaticKeyProvider } from "../src/crypto/keyProvider.ts";
import { modelListServer, until } from "./helpers/fixtures.ts";

describe("Phase 1 API end to end", () => {
  it("authenticates, onboards, streams a demo approval and executes it with a secret-free audit trail", async () => {
    const app = new App({
      dataDir: ":memory:",
      keyProvider: new StaticKeyProvider(randomBytes(32)),
      mockModel: true,
    });
    await app.start();
    onTestFinished(() => app.stop());
    const server = await startServer(app, { port: 0, token: "test-session" });
    onTestFinished(() => server.close());
    const base = `http://127.0.0.1:${server.port}`;
    const api = (path: string, method = "GET", body?: unknown) =>
      fetch(`${base}${path}`, {
        method,
        headers: { authorization: "Bearer test-session", "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true });
    expect((await fetch(`${base}/api/state`)).status).toBe(401);
    expect(
      (await fetch(`${base}/api/state`, { headers: { authorization: "Bearer wrong" } })).status,
    ).toBe(401);
    const secret = "synthetic-e2e-model-key-no-real-credentials";
    const onboarding = await api("/api/onboarding", "POST", {
      profile: { name: "Test User", city: "Test City", addresses: [] },
      model: { provider: "openai", model: "test-chat", baseUrl: await modelListServer() },
      apiKey: secret,
    });
    expect(onboarding.status).toBe(200);
    expect(await onboarding.json()).toMatchObject({ onboarded: true, keySaved: true });
    const stateResponse = await api("/api/state");
    const stateJson = await stateResponse.text();
    expect(JSON.parse(stateJson) as AppState).toMatchObject({ onboarded: true, keySaved: true });
    expect(stateJson).not.toContain(secret);
    const create = await api("/api/conversations", "POST");
    expect(create.status).toBe(200);
    const conversation = (await create.json()) as Conversation;

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/events?token=test-session`);
    const events: (ServerEvent | { type: "hello" })[] = [];
    const wsErrors: Error[] = [];
    ws.on("message", (data) => events.push(JSON.parse(data.toString())));
    ws.on("error", (error) => wsErrors.push(error));
    onTestFinished(() => ws.terminate());
    await until(() => events.some((event) => event.type === "hello"), Boolean);
    const sent = await api(`/api/conversations/${conversation.id}/messages`, "POST", {
      text: "try a demo action",
    });
    expect(sent.status).toBe(202);
    const pendingEvent = await until(
      () => events.find((event) => event.type === "action.pending"),
      Boolean,
    );
    if (pendingEvent?.type !== "action.pending") throw new Error("Missing pending event");
    const action = pendingEvent.action;
    expect(action).toMatchObject({
      conversationId: conversation.id,
      toolName: "demo_send_note",
      status: "pending",
    });
    // A paused segment also emits run.finished; wait for its persisted card before approving.
    await until(
      async () =>
        (await (await api(`/api/conversations/${conversation.id}`)).json()) as {
          messages: Message[];
          busy: boolean;
        },
      (data) =>
        !data.busy &&
        data.messages.some((m) =>
          m.parts.some((p) => p.type === "action" && p.actionId === action.id),
        ),
    );
    const beforeApproval = events.length;
    const approved = await api(`/api/actions/${action.id}/approve`, "POST", { mode: "once" });
    expect(approved.status).toBe(200);
    await until(
      () =>
        events
          .slice(beforeApproval)
          .some((event) => event.type === "run.finished" && event.runId === action.runId),
      Boolean,
    );
    const detail = (await (await api(`/api/conversations/${conversation.id}`)).json()) as {
      messages: Message[];
      actions: PendingAction[];
    };
    const final = detail.messages
      .filter((m) => m.role === "assistant")
      .find((m) => m.parts.some((p) => p.type === "text" && /was sent/.test(p.text)));
    expect(final).toBeDefined();
    expect(detail.actions.find((a) => a.id === action.id)?.status).toBe("executed");
    const audit = (await (await api("/api/audit")).json()) as AuditEvent[];
    for (const kind of ["action.created", "action.approved", "action.executed"])
      expect(audit.some((event) => event.kind === kind)).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(secret);
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(wsErrors).toEqual([]);

    const badWs = new WebSocket(`ws://127.0.0.1:${server.port}/api/events?token=wrong`);
    onTestFinished(() => badWs.terminate());
    const rejected = new Promise<number>((resolve, reject) => {
      badWs.once("unexpected-response", (_req, res) => {
        res.resume();
        badWs.terminate();
        resolve(res.statusCode!);
      });
      badWs.once("open", () => reject(new Error("Bad token was accepted")));
      badWs.on("error", () => {});
    });
    expect(await rejected).toBe(401);
  });
});
