import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { McpServerInput, ToolClass, type ActPreview, type McpServer, type McpTool, type ToolDef } from "@relayit/shared";
import type { App } from "../app.ts";
import { HttpError } from "../app.ts";
import type { RouteModule } from "../api/server.ts";
import { body } from "../api/server.ts";
import { newId, nowIso } from "../util/ids.ts";
import { errMessage } from "../util/time.ts";
import { parse, json } from "../store/db.ts";
import { builtinServer } from "../util/paths.ts";
import { openUrl } from "../util/openUrl.ts";

/** One-click connections to official MCP servers. Vendors' own servers come first; the browser agent is the fallback. */
export const MCP_PRESETS = [
  { id: "swiggy-food", name: "Swiggy Food", url: "https://mcp.swiggy.com/food", domain: "food", blurb: "Order food from Swiggy with your own account." },
  { id: "swiggy-instamart", name: "Swiggy Instamart", url: "https://mcp.swiggy.com/im", domain: "grocery", blurb: "Groceries in minutes." },
  { id: "swiggy-dineout", name: "Swiggy Dineout", url: "https://mcp.swiggy.com/dineout", domain: "food", blurb: "Book tables and dining offers." },
  { id: "zomato", name: "Zomato", url: "https://mcp-server.zomato.com/mcp", domain: "food", blurb: "Search restaurants and order on Zomato." },
  { id: "wispr-flow", name: "Wispr Flow", url: "https://api.wisprflow.ai/connect/mcp", domain: "meetings", blurb: "Your meeting notes, scratchpad and tasks." },
  { id: "notion", name: "Notion", url: "https://mcp.notion.com/mcp", domain: "notes", blurb: "Search and update your Notion pages." },
  { id: "linear", name: "Linear", url: "https://mcp.linear.app/mcp", domain: "work", blurb: "Issues and projects." },
] as const;

const MONEY_HINT = /(place|confirm|checkout|pay|purchase|buy|book|order)(_|$|[A-Z])/i;
const OAUTH_PORT = 47833;

type Live = { client: Client; transport: StdioClientTransport | StreamableHTTPClientTransport; status: McpServer["status"]; error: string | null };

export class McpManager {
  private live = new Map<string, Live>();
  private pendingAuth = new Map<string, { verifier?: string; state: string }>();
  private oauthServer: Server | null = null;

  private app: App;
  constructor(app: App) {
    this.app = app;
  }

  /* ───────────── lifecycle ───────────── */

  async start(): Promise<void> {
    await this.ensureBuiltins();
    const rows = await this.app.db.selectFrom("mcp_servers").selectAll().where("enabled", "=", 1).execute();
    await Promise.all(rows.map((r) => this.connect(r.id).catch(() => {})));
  }

  async stop(): Promise<void> {
    for (const [id] of this.live) await this.disconnect(id);
    this.oauthServer?.close();
  }

  private async ensureBuiltins() {
    for (const b of [
      { id: "builtin-food", name: "RelayIt Food (demo)", key: "food", domain: "food" },
      { id: "builtin-travel", name: "Trains, metro & cabs", key: "travel", domain: "travel" },
    ]) {
      const exists = await this.app.db.selectFrom("mcp_servers").select("id").where("id", "=", b.id).executeTakeFirst();
      const cmd = builtinServer(b.key);
      if (!exists) {
        await this.app.db.insertInto("mcp_servers").values({
          id: b.id, name: b.name, transport: "stdio", command: cmd.command, args: json(cmd.args), env: "{}", url: null,
          domain: b.domain, enabled: 1, builtin: 1, created_at: nowIso(),
        }).execute();
      } else {
        // Paths change between dev and packaged builds; always refresh them.
        await this.app.db.updateTable("mcp_servers").set({ command: cmd.command, args: json(cmd.args) }).where("id", "=", b.id).execute();
      }
    }
  }

  async connect(id: string): Promise<void> {
    const row = await this.app.db.selectFrom("mcp_servers").selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) throw new HttpError(404, "Connection not found");
    await this.disconnect(id);
    const client = new Client({ name: "relayit", version: "0.1.0" });
    let transport: Live["transport"];
    if (row.transport === "stdio") {
      // The SDK uses cross-spawn: it resolves Windows .cmd shims (e.g. npx) and escapes arguments.
      transport = new StdioClientTransport({
        command: row.command!,
        args: parse<string[]>(row.args, []),
        env: { ...safeEnv(), RELAYIT_DATA_DIR: this.app.opts.dataDir === ":memory:" ? "" : join(this.app.opts.dataDir, "connectors", id), ...(await this.envFor(id, row.env)) },
        stderr: "pipe",
      });
    } else {
      transport = new StreamableHTTPClientTransport(new URL(row.url!), { authProvider: this.authProvider(id) });
    }
    const live: Live = { client, transport, status: "connecting", error: null };
    this.live.set(id, live);
    this.changed();
    try {
      await client.connect(transport);
      live.status = "connected";
      await this.syncTools(id, row.builtin === 1, row.domain);
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        live.status = "needs_auth";
        live.error = "Sign in to finish connecting.";
      } else {
        live.status = "error";
        live.error = errMessage(e);
      }
    }
    this.changed();
  }

  async disconnect(id: string): Promise<void> {
    const l = this.live.get(id);
    this.app.registry.unregisterSource(id);
    if (!l) return;
    this.live.delete(id);
    await l.client.close().catch(() => {});
  }

  private changed() {
    this.app.bus.emit({ type: "connections.updated" });
  }

  /* ───────────── tools ───────────── */

  private async syncTools(id: string, builtin: boolean, domain: string) {
    const live = this.live.get(id)!;
    const { tools } = await live.client.listTools();
    const stored = new Map(
      (await this.app.db.selectFrom("mcp_tools").selectAll().where("server_id", "=", id).execute()).map((t) => [t.name, t]),
    );
    this.app.registry.unregisterSource(id);
    const serverRow = await this.app.db.selectFrom("mcp_servers").select(["name", "url"]).where("id", "=", id).executeTakeFirstOrThrow();
    const preset = MCP_PRESETS.find((p) => p.url === serverRow.url);
    const prefix = builtin ? "" : `${slug(serverRow.name)}__`;

    for (const t of tools) {
      const meta = (t._meta ?? {}) as Record<string, unknown>;
      const declared = ToolClass.safeParse(meta["relayit/class"]);
      const fromAnnotations = preset && t.annotations?.readOnlyHint === true ? "read" : null;
      const defaultClass: ToolClass = declared.success ? declared.data : fromAnnotations ?? "act";
      const prev = stored.get(t.name);
      const toolClass = (prev?.tool_class as ToolClass | undefined) ?? defaultClass;
      const enabled = prev ? prev.enabled === 1 : true;
      if (!prev) {
        await this.app.db.insertInto("mcp_tools").values({
          server_id: id, name: t.name, description: t.description ?? "", tool_class: toolClass, enabled: 1, meta: json(meta),
        }).execute();
      } else {
        await this.app.db.updateTable("mcp_tools").set({ description: t.description ?? "", meta: json(meta) }).where("server_id", "=", id).where("name", "=", t.name).execute();
      }
      if (!enabled) continue;
      const internal = meta["relayit/internal"] === true;
      const service = typeof meta["relayit/service"] === "string" ? (meta["relayit/service"] as string) : serverRow.name;
      const label = typeof meta["relayit/label"] === "string" ? (meta["relayit/label"] as string) : null;
      const previewTool = typeof meta["relayit/previewTool"] === "string" ? (meta["relayit/previewTool"] as string) : null;
      const money = meta["relayit/money"] === true || (!builtin && toolClass === "act" && MONEY_HINT.test(t.name));
      const name = `${prefix}${t.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      const def: ToolDef = {
        name,
        description: (t.description ?? t.title ?? t.name).slice(0, 1000),
        domain: preset?.domain ?? domain,
        toolClass,
        service,
        input: z.record(z.string(), z.unknown()),
        ...(label ? { label: () => label } : {}),
        involvesMoney: money,
        // Content from third-party servers is outside content; RelayIt's own demo servers are trusted.
        untrustedOutput: !builtin,
        timeoutMs: 60_000,
        run: async (input, ctx) => this.call(id, t.name, toolClass === "act" && ctx.idempotencyKey ? { ...input, ...(acceptsIdempotency(t.inputSchema) ? { idempotencyKey: ctx.idempotencyKey } : {}) } : input),
        ...(toolClass === "act"
          ? {
              preview: async (input: Record<string, unknown>): Promise<ActPreview> => {
                if (previewTool) {
                  const p = (await this.call(id, previewTool, input)) as ActPreview;
                  if (p && typeof p.title === "string") return { ...p, service: p.service || service };
                }
                return {
                  title: `${service}: ${humanize(t.name)}`,
                  summary: t.description?.split(/(?<=\.)\s/)[0] ?? "Run this action.",
                  service,
                  details: Object.entries(input).slice(0, 8).map(([k, v]) => ({ label: humanize(k), value: typeof v === "string" ? v : JSON.stringify(v) })),
                };
              },
            }
          : {}),
      };
      this.app.registry.register(def, id, { parameters: normaliseSchema(t.inputSchema), remoteName: t.name, ...(internal ? { internal: true } : {}) });
    }
  }

  /** Calls a tool on a server and returns parsed JSON (or text). Throws on tool errors. */
  async call(serverId: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
    const live = this.live.get(serverId);
    if (!live || live.status !== "connected") throw new Error("That connection isn't available right now.");
    const res = await live.client.callTool({ name: tool, arguments: args }, undefined, { timeout: 60_000 });
    const content = (res.content ?? []) as { type: string; text?: string }[];
    const text = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    if (res.isError) throw new Error(text || "The tool reported an error");
    if (res.structuredContent) return res.structuredContent;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /** Calls a RelayIt-internal tool on a built-in server by tool name, wherever it lives. */
  async callInternal(tool: string, args: Record<string, unknown>): Promise<unknown> {
    for (const [id, l] of this.live) {
      if (l.status !== "connected") continue;
      const row = await this.app.db.selectFrom("mcp_tools").select("name").where("server_id", "=", id).where("name", "=", tool).executeTakeFirst();
      if (row) return this.call(id, tool, args);
    }
    throw new Error(`No connection provides ${tool}`);
  }

  /* ───────────── OAuth for remote servers ───────────── */

  private authProvider(id: string): OAuthClientProvider {
    const app = this.app;
    const key = (k: string) => `mcp.oauth.${id}.${k}`;
    return {
      get redirectUrl() {
        return `http://127.0.0.1:${OAUTH_PORT}/callback`;
      },
      get clientMetadata(): OAuthClientMetadata {
        return {
          client_name: "RelayIt",
          redirect_uris: [`http://127.0.0.1:${OAUTH_PORT}/callback`],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        };
      },
      state: () => {
        const s = randomUUID();
        this.pendingAuth.set(id, { ...(this.pendingAuth.get(id) ?? {}), state: s });
        return s;
      },
      clientInformation: async () => {
        const v = await app.secrets.get(key("client"));
        return v ? (JSON.parse(v) as OAuthClientInformationMixed) : undefined;
      },
      saveClientInformation: async (info) => app.secrets.set(key("client"), JSON.stringify(info)),
      tokens: async () => {
        const v = await app.secrets.get(key("tokens"));
        return v ? (JSON.parse(v) as OAuthTokens) : undefined;
      },
      saveTokens: async (t) => app.secrets.set(key("tokens"), JSON.stringify(t)),
      redirectToAuthorization: async (url) => {
        await this.ensureOAuthServer();
        openUrl(url.toString());
      },
      saveCodeVerifier: async (v) => app.secrets.set(key("verifier"), v),
      codeVerifier: async () => (await app.secrets.get(key("verifier"))) ?? "",
      invalidateCredentials: async (scope) => {
        if (scope === "all" || scope === "tokens") await app.secrets.delete(key("tokens"));
        if (scope === "all" || scope === "client") await app.secrets.delete(key("client"));
        if (scope === "all" || scope === "verifier") await app.secrets.delete(key("verifier"));
      },
    };
  }

  /** Starts the sign-in flow for a remote server (opens the browser). */
  async authorize(id: string): Promise<void> {
    await this.connect(id);
  }

  private async ensureOAuthServer(): Promise<void> {
    if (this.oauthServer) return;
    this.oauthServer = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${OAUTH_PORT}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const entry = [...this.pendingAuth.entries()].find(([, v]) => v.state === state);
      const ok = !!code && !!entry;
      res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8" });
      res.end(callbackPage(ok));
      if (!ok || !entry) return;
      const [id] = entry;
      this.pendingAuth.delete(id);
      const live = this.live.get(id);
      if (live?.transport instanceof StreamableHTTPClientTransport) {
        try {
          await live.transport.finishAuth(code!);
          await this.app.audit.log({ kind: "connection.changed", summary: "Signed in to a connection" });
          await this.connect(id);
        } catch (e) {
          live.status = "error";
          live.error = errMessage(e);
          this.changed();
        }
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.oauthServer!.once("error", reject);
      this.oauthServer!.listen(OAUTH_PORT, "127.0.0.1", () => resolve());
    });
  }

  private async envFor(id: string, stored: string): Promise<Record<string, string>> {
    // Env values for third-party servers are stored as secrets (they're usually API keys).
    const names = parse<string[]>(stored, []);
    const out: Record<string, string> = {};
    for (const n of Array.isArray(names) ? names : []) {
      const v = await this.app.secrets.get(`mcp.env.${id}.${n}`);
      if (v) out[n] = v;
    }
    return out;
  }

  /* ───────────── views ───────────── */

  async list(): Promise<McpServer[]> {
    const rows = await this.app.db.selectFrom("mcp_servers").selectAll().orderBy("builtin", "desc").orderBy("created_at").execute();
    const tools = await this.app.db.selectFrom("mcp_tools").selectAll().execute();
    return rows.map((r) => {
      const l = this.live.get(r.id);
      return {
        id: r.id, name: r.name, transport: r.transport as McpServer["transport"], command: r.builtin ? null : r.command,
        args: r.builtin ? [] : parse<string[]>(r.args, []), url: r.url, domain: r.domain, enabled: r.enabled === 1, builtin: r.builtin === 1,
        status: r.enabled === 1 ? (l?.status ?? "disconnected") : "disconnected", error: l?.error ?? null,
        tools: tools.filter((t) => t.server_id === r.id && parse<Record<string, unknown>>(t.meta, {})["relayit/internal"] !== true)
          .map<McpTool>((t) => ({ name: t.name, description: t.description, toolClass: t.tool_class as ToolClass, enabled: t.enabled === 1 })),
      };
    });
  }

  async add(input: McpServerInput & { envSecrets?: Record<string, string> }): Promise<McpServer> {
    if (input.transport === "stdio" && !input.command) throw new HttpError(400, "A command is required for local servers");
    if (input.transport === "http") {
      if (!input.url) throw new HttpError(400, "A URL is required for remote servers");
      const u = new URL(input.url);
      if (u.protocol !== "https:" && !/^(127\.0\.0\.1|localhost)$/.test(u.hostname)) throw new HttpError(400, "Remote servers must use https");
    }
    const id = newId("mcp");
    const envNames = Object.keys(input.envSecrets ?? input.env ?? {});
    for (const [k, v] of Object.entries(input.envSecrets ?? input.env ?? {})) await this.app.secrets.set(`mcp.env.${id}.${k}`, v);
    await this.app.db.insertInto("mcp_servers").values({
      id, name: input.name, transport: input.transport, command: input.command ?? null, args: json(input.args ?? []), env: json(envNames),
      url: input.url ?? null, domain: input.domain ?? "general", enabled: 1, builtin: 0, created_at: nowIso(),
    }).execute();
    await this.app.audit.log({ kind: "connection.changed", summary: `Added connection: ${input.name}`, data: { transport: input.transport, url: input.url ?? null, command: input.command ?? null } });
    await this.connect(id).catch(() => {});
    return (await this.list()).find((s) => s.id === id)!;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.app.db.updateTable("mcp_servers").set({ enabled: enabled ? 1 : 0 }).where("id", "=", id).execute();
    await this.app.audit.log({ kind: "connection.changed", summary: `${enabled ? "Enabled" : "Disabled"} a connection` });
    if (enabled) await this.connect(id).catch(() => {});
    else await this.disconnect(id);
    this.changed();
  }

  async remove(id: string): Promise<void> {
    const row = await this.app.db.selectFrom("mcp_servers").select(["builtin", "name", "env"]).where("id", "=", id).executeTakeFirst();
    if (!row) return;
    if (row.builtin) throw new HttpError(400, "Built-in connections can be disabled but not removed.");
    await this.disconnect(id);
    for (const n of parse<string[]>(row.env, [])) await this.app.secrets.delete(`mcp.env.${id}.${n}`);
    for (const k of ["client", "tokens", "verifier"]) await this.app.secrets.delete(`mcp.oauth.${id}.${k}`);
    await this.app.db.deleteFrom("mcp_servers").where("id", "=", id).execute();
    await this.app.audit.log({ kind: "connection.changed", summary: `Removed connection: ${row.name}` });
    this.changed();
  }

  async setTool(serverId: string, tool: string, patch: { toolClass?: ToolClass; enabled?: boolean }): Promise<void> {
    await this.app.db.updateTable("mcp_tools").set({
      ...(patch.toolClass ? { tool_class: patch.toolClass } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled ? 1 : 0 } : {}),
    }).where("server_id", "=", serverId).where("name", "=", tool).execute();
    await this.app.audit.log({ kind: "connection.changed", summary: `Changed ${tool}: ${patch.toolClass ? `now ${patch.toolClass}` : ""}${patch.enabled !== undefined ? (patch.enabled ? " enabled" : " disabled") : ""}`.trim() });
    const row = await this.app.db.selectFrom("mcp_servers").select(["builtin", "domain"]).where("id", "=", serverId).executeTakeFirst();
    if (row && this.live.get(serverId)?.status === "connected") await this.syncTools(serverId, row.builtin === 1, row.domain);
    this.changed();
  }
}

export function mcpRoutes(m: McpManager): RouteModule {
  return (api) => {
    api.get("/api/mcp/servers", async (c) => c.json(await m.list()));
    api.get("/api/mcp/presets", (c) => c.json(MCP_PRESETS));
    api.post("/api/mcp/servers", async (c) => {
      const input = await body(c, McpServerInput.extend({ envSecrets: z.record(z.string(), z.string()).optional() }));
      return c.json(await m.add(input));
    });
    api.patch("/api/mcp/servers/:id", async (c) => {
      const p = await body(c, z.object({ enabled: z.boolean() }));
      await m.setEnabled(c.req.param("id"), p.enabled);
      return c.json((await m.list()).find((s) => s.id === c.req.param("id")) ?? null);
    });
    api.delete("/api/mcp/servers/:id", async (c) => {
      await m.remove(c.req.param("id"));
      return c.json({ ok: true });
    });
    api.post("/api/mcp/servers/:id/reconnect", async (c) => {
      await m.connect(c.req.param("id"));
      return c.json((await m.list()).find((s) => s.id === c.req.param("id")) ?? null);
    });
    api.patch("/api/mcp/servers/:id/tools/:tool", async (c) => {
      const p = await body(c, z.object({ toolClass: ToolClass.optional(), enabled: z.boolean().optional() }));
      await m.setTool(c.req.param("id"), decodeURIComponent(c.req.param("tool")), p);
      return c.json({ ok: true });
    });
  };
}

/* ───────────── helpers ───────────── */

export function safeEnv(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Record<string, string> {
  // Pass only what servers need to run; never our own secrets.
  const keep = ["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TMPDIR", "TEMP", "TMP", "SystemRoot", "LANG", "LC_ALL"];
  if (platform === "win32") {
    keep.push("PATHEXT", "COMSPEC", "SystemDrive", "HOMEDRIVE", "HOMEPATH", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData");
    // Windows env names are case-insensitive. Canonical keys also avoid duplicate Path/PATH entries.
    const allowed = new Set(keep.map((key) => key.toUpperCase()));
    return Object.fromEntries(Object.entries(env).filter(([key, value]) => allowed.has(key.toUpperCase()) && value)
      .map(([key, value]) => [key.toUpperCase(), value!]));
  }
  return Object.fromEntries(keep.filter((k) => env[k]).map((k) => [k, env[k]!]));
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 20) || "mcp";
}

function humanize(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

function acceptsIdempotency(schema: unknown): boolean {
  const props = (schema as { properties?: Record<string, unknown> } | undefined)?.properties;
  return !!props && "idempotencyKey" in props;
}

function normaliseSchema(schema: unknown): Record<string, unknown> {
  const s = (schema && typeof schema === "object" ? { ...(schema as Record<string, unknown>) } : {}) as Record<string, unknown>;
  delete s.$schema;
  if (s.type !== "object") return { type: "object", properties: {}, additionalProperties: true };
  // Core injects idempotency keys; hide them from the model.
  if (s.properties && typeof s.properties === "object" && "idempotencyKey" in (s.properties as object)) {
    const { idempotencyKey: _drop, ...rest } = s.properties as Record<string, unknown>;
    s.properties = rest;
    if (Array.isArray(s.required)) s.required = (s.required as string[]).filter((r) => r !== "idempotencyKey");
  }
  return s;
}

function callbackPage(ok: boolean): string {
  return `<!doctype html><meta charset="utf-8"><title>RelayIt</title><body style="font:15px/1.5 -apple-system,Segoe UI,sans-serif;background:#f6f4f0;color:#1c1a16;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center;max-width:360px"><div style="width:48px;height:48px;border-radius:14px;background:${ok ? "#e4572e" : "#cf3f36"};margin:0 auto 16px"></div><h1 style="font-size:20px;margin:0 0 6px">${ok ? "You're connected" : "That didn't work"}</h1><p style="color:#77726a;margin:0">${ok ? "You can close this tab and go back to RelayIt." : "Go back to RelayIt and try connecting again."}</p></div></body>`;
}
