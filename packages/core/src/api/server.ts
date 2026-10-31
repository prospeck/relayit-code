import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { serve, type ServerType } from "@hono/node-server";
import { WebSocketServer, type WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import {
  ApproveRequest, MemoryFactInput, OnboardingRequest, Profile, SendMessageRequest, Settings, TaskStatus, ValidateKeyRequest,
} from "@relayit/shared";
import { type App, HttpError } from "../app.ts";
import { validateKey, detectOllama, rankModels } from "../models/index.ts";
import { BusyError } from "../agent/loop.ts";
import { errMessage } from "../util/time.ts";

export type ApiEnv = { Variables: { app: App } };
export type RouteModule = (api: Hono<ApiEnv>, app: App) => void;

const ALLOWED_ORIGINS = [/^tauri:\/\/localhost$/, /^https?:\/\/tauri\.localhost$/, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/];

export async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, "Expected a JSON body");
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

export function buildApi(app: App, token: string, modules: RouteModule[] = []): Hono<ApiEnv> {
  const api = new Hono<ApiEnv>();
  api.use("*", cors({ origin: (o) => (ALLOWED_ORIGINS.some((re) => re.test(o)) ? o : null), allowHeaders: ["authorization", "content-type"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"] }));
  api.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/health") return next();
    const header = c.req.header("authorization")?.replace(/^Bearer /, "") ?? "";
    if (!safeEqual(header, token)) return c.json({ error: "Unauthorized" }, 401);
    c.set("app", app);
    return next();
  });
  api.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    if (err instanceof BusyError) return c.json({ error: err.message }, 409);
    console.error("[api]", err);
    return c.json({ error: app.redactor.text(errMessage(err)) }, 500);
  });

  api.get("/api/health", (c) => c.json({ ok: true }));
  api.get("/api/state", async (c) => c.json(await app.state()));

  /* onboarding, profile, settings, model */
  api.post("/api/onboarding", async (c) => {
    const req = await body(c, OnboardingRequest);
    let available: string[] = [];
    if (req.model.provider !== "ollama" || req.apiKey) {
      const v = await validateKey(req.model.provider, req.apiKey, req.model.baseUrl);
      if (!v.ok && !app.opts.mockModel) throw new HttpError(400, v.error ?? "That key didn't work");
      available = v.models;
    }
    await app.kv.set("profile", req.profile);
    await app.saveModel(req.model, req.apiKey, available);
    await app.kv.set("onboarded", true);
    await app.audit.log({ kind: "settings.changed", summary: `Welcome, ${req.profile.name}. Setup finished with ${req.model.provider} (${req.model.model}).` });
    return c.json(await app.state());
  });
  api.put("/api/profile", async (c) => {
    const p = await body(c, Profile);
    await app.kv.set("profile", p);
    await app.audit.log({ kind: "settings.changed", summary: "Profile updated" });
    return c.json(p);
  });
  api.patch("/api/settings", async (c) => c.json(await app.updateSettings(await body(c, Settings.partial()))));
  api.post("/api/models/validate", async (c) => {
    const req = await body(c, ValidateKeyRequest);
    // Re-validating the saved key: the UI never has it, so fall back to the stored one.
    const key = req.apiKey || (await app.secrets.get(app.keyName(req.provider))) || undefined;
    return c.json(await validateKey(req.provider, key, req.baseUrl));
  });
  api.get("/api/models/ollama", async (c) => {
    const r = await detectOllama();
    return c.json({ ...r, models: rankModels("ollama", r.models) });
  });
  api.put("/api/models/config", async (c) => {
    const { model, apiKey } = await body(c, OnboardingRequest.pick({ model: true, apiKey: true }));
    const key = apiKey || (await app.secrets.get(app.keyName(model.provider))) || undefined;
    const v = model.provider === "ollama" && !key ? { ok: true, models: [] as string[] } : await validateKey(model.provider, key, model.baseUrl);
    if (!v.ok && !app.opts.mockModel) throw new HttpError(400, v.error ?? "That key didn't work");
    await app.saveModel(model, apiKey, v.models);
    return c.json(await app.state());
  });
  api.delete("/api/models/key/:provider", async (c) => {
    await app.secrets.delete(app.keyName(c.req.param("provider")));
    await app.audit.log({ kind: "secret.deleted", summary: `API key removed for ${c.req.param("provider")}` });
    return c.json(await app.state());
  });

  /* conversations */
  api.get("/api/conversations", async (c) => c.json(await app.chat.listConversations()));
  api.post("/api/conversations", async (c) => c.json(await app.chat.createConversation("New chat")));
  api.get("/api/conversations/:id", async (c) => {
    const conv = await app.chat.getConversation(c.req.param("id"));
    if (!conv) throw new HttpError(404, "Conversation not found");
    const [messages, actions] = await Promise.all([app.chat.listMessages(conv.id), app.actions.list({ conversationId: conv.id, limit: 200 })]);
    return c.json({ conversation: conv, messages, actions, busy: app.agent.isBusy(conv.id) });
  });
  api.delete("/api/conversations/:id", async (c) => {
    await app.chat.deleteConversation(c.req.param("id"));
    return c.json({ ok: true });
  });
  api.post("/api/conversations/:id/messages", async (c) => {
    const id = c.req.param("id");
    const req = await body(c, SendMessageRequest);
    if (!(await app.chat.getConversation(id))) throw new HttpError(404, "Conversation not found");
    if (app.agent.isBusy(id)) throw new BusyError();
    let text = req.text;
    let skill = req.skill ?? null;
    const slash = /^\/([a-z0-9-]+)\b\s*/.exec(text);
    if (slash && (await app.skills.getBySlug(slash[1]!))) {
      skill = slash[1]!;
      text = text.slice(slash[0].length) || `Run the /${skill} skill.`;
    }
    // Run in the background; progress streams over the WebSocket.
    void app.agent.send(id, text, { skill }).catch((e) => console.error("[agent]", e));
    return c.json({ ok: true }, 202);
  });
  api.post("/api/conversations/:id/stop", async (c) => c.json({ stopped: app.agent.stop(c.req.param("id")) }));

  /* approvals */
  api.get("/api/actions", async (c) => c.json(await app.actions.list({ ...(c.req.query("status") ? { status: c.req.query("status") } : {}), limit: 200 })));
  api.post("/api/actions/:id/approve", async (c) => c.json(await app.approve(c.req.param("id"), (await body(c, ApproveRequest)).mode)));
  api.post("/api/actions/:id/refuse", async (c) => c.json(await app.refuse(c.req.param("id"))));
  api.get("/api/approval-rules", async (c) => c.json(await app.actions.listRules()));
  api.delete("/api/approval-rules/:id", async (c) => {
    await app.actions.deleteRule(c.req.param("id"));
    await app.audit.log({ kind: "settings.changed", summary: "Removed an “Always allow” rule" });
    return c.json({ ok: true });
  });

  /* activity */
  api.get("/api/audit", async (c) =>
    c.json(await app.audit.list({ limit: Number(c.req.query("limit") ?? 100), before: c.req.query("before"), kind: c.req.query("kind"), q: c.req.query("q") })),
  );

  /* tasks */
  api.get("/api/tasks", async (c) => c.json(await app.tasks.list()));
  api.patch("/api/tasks/:id", async (c) => {
    const { status } = await body(c, TaskStatus.transform((s) => ({ status: s })).or(ApproveTaskBody));
    await app.tasks.setStatus(c.req.param("id"), status);
    app.bus.emit({ type: "tasks.updated" });
    return c.json({ ok: true });
  });
  api.delete("/api/tasks/:id", async (c) => {
    await app.tasks.delete(c.req.param("id"));
    app.bus.emit({ type: "tasks.updated" });
    return c.json({ ok: true });
  });

  /* memory */
  api.get("/api/memory", async (c) => c.json(await app.memory.list()));
  api.post("/api/memory", async (c) => c.json(await app.memory.upsert(await body(c, MemoryFactInput), "user")));
  api.delete("/api/memory/:id", async (c) => {
    await app.memory.delete(c.req.param("id"));
    return c.json({ ok: true });
  });

  /* extra provider keys (write-only) */
  const EXTRA_KEYS = ["exa", "groq", "openai"] as const;
  api.get("/api/keys", async (c) => c.json(Object.fromEntries(await Promise.all(EXTRA_KEYS.map(async (k) => [k, await app.secrets.has(`key.${k}`)] as const)))));
  api.put("/api/keys/:name", async (c) => {
    const name = c.req.param("name");
    if (!(EXTRA_KEYS as readonly string[]).includes(name)) throw new HttpError(404, "Unknown key");
    const { value } = await body(c, zod.object({ value: zod.string().min(8).max(500) }));
    await app.secrets.set(`key.${name}`, value.trim());
    await app.audit.log({ kind: "secret.saved", summary: `${name} key saved` });
    return c.json({ ok: true });
  });

  /* tools overview (for Connections) */
  api.get("/api/tools", (c) =>
    c.json(app.registry.list().filter((t) => !t.internal).map((t) => ({ name: t.def.name, description: t.def.description, domain: t.def.domain, toolClass: t.def.toolClass, service: t.def.service, source: t.source }))),
  );

  for (const m of modules) m(api, app);
  return api;
}

import { z as zod } from "zod";
const ApproveTaskBody = zod.object({ status: TaskStatus });

export async function startServer(app: App, opts: { port?: number; token: string; modules?: RouteModule[] }): Promise<{ port: number; close: () => Promise<void> }> {
  const api = buildApi(app, opts.token, opts.modules);
  const wss = new WebSocketServer({ noServer: true });
  const sockets = new Set<WebSocket>();
  const off = app.bus.on((event) => {
    const data = JSON.stringify(event);
    for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(data);
  });

  const server: ServerType = await new Promise((resolve) => {
    const s = serve({ fetch: api.fetch, port: opts.port ?? 0, hostname: "127.0.0.1" }, () => resolve(s));
  });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const origin = req.headers.origin;
    if (url.pathname !== "/api/events" || !safeEqual(url.searchParams.get("token") ?? "", opts.token) || (origin && !ALLOWED_ORIGINS.some((re) => re.test(origin)))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      ws.on("close", () => sockets.delete(ws));
      ws.send(JSON.stringify({ type: "hello" }));
    });
  });
  const ping = setInterval(() => {
    for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.ping();
  }, 20_000);
  ping.unref();

  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: async () => {
      off();
      clearInterval(ping);
      for (const ws of sockets) ws.terminate();
      wss.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
