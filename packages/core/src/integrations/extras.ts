import { join } from "node:path";
import { z } from "zod";
import {
  BrowserSession,
  RECIPES,
  SITE_LIST,
  createBrowserTools,
  openLoginWindow,
} from "@relayit/connector-browser";
import { createWebTools } from "@relayit/connector-web";
import { detectLocalWhisper, pickTranscriber } from "@relayit/connector-voice";
import type { ToolDef } from "@relayit/shared";
import type { App } from "../app.ts";
import { HttpError } from "../app.ts";
import type { RouteModule } from "../api/server.ts";
import { body } from "../api/server.ts";
import { nowIso } from "../util/ids.ts";
import { errMessage } from "../util/time.ts";

/* ───────────── Browser agent ───────────── */

/**
 * Drives a separate Chromium profile signed in as the user, for services with no official connection.
 * Every submit is an `act`; logins, OTPs and payments are always done by the user in the visible window.
 */
export class BrowserIntegration {
  private session: BrowserSession | null = null;
  private headless: boolean | null = null;
  private currentConversation: string | null = null;

  private app: App;
  constructor(app: App) {
    this.app = app;
  }

  start() {
    const tools = createBrowserTools({
      getSession: () => this.get(),
      isEnabled: async () => (await this.app.settings()).browserAgentEnabled,
    }).map((t): ToolDef => ({
      ...t,
      // Remember which chat is driving the browser so live frames show up in the right place.
      run: async (input, ctx) => {
        this.currentConversation = ctx.conversationId;
        const site = RECIPES.find(
          (r) =>
            typeof (input as { url?: string }).url === "string" &&
            r.hosts.some((h) => (input as { url: string }).url.includes(h)),
        );
        if (site) await this.app.kv.set(`browser.used.${site.id}`, nowIso());
        return t.run(input, ctx);
      },
    }));
    this.app.registry.registerAll(tools, "browser");
    this.app.addSystemExtra(async () => {
      if (!(await this.app.settings()).browserAgentEnabled)
        return "# Browser agent\nThe browser agent is turned off in Settings.";
      return `# Browser agent playbooks (best-effort; sites change)\n${RECIPES.map((r) => `- ${r.playbook}`).join("\n")}\nNever type passwords, OTPs, card numbers or UPI PINs — ask the user to do those steps in the RelayIt browser window.`;
    });
    this.app.onShutdown(async () => {
      await this.session?.close().catch(() => {});
    });
  }

  private async get(): Promise<BrowserSession> {
    const settings = await this.app.settings();
    if (this.session && this.headless === settings.browserHeadless) return this.session;
    await this.session?.close().catch(() => {});
    this.headless = settings.browserHeadless;
    this.session = new BrowserSession({
      profileDir: join(this.app.opts.dataDir, "browser-profile"),
      headless: settings.browserHeadless,
    });
    this.session.onFrame((f) => {
      if (this.currentConversation)
        this.app.bus.emit({
          type: "browser.frame",
          conversationId: this.currentConversation,
          url: f.url,
          jpegBase64: f.jpegBase64,
        });
    });
    return this.session;
  }

  routes(): RouteModule {
    return (api) => {
      api.get("/api/browser/sessions", async (c) =>
        c.json(
          await Promise.all(
            SITE_LIST.map(async (s) => ({
              site: s.name,
              id: s.id,
              loggedIn: !!(await this.app.kv.get<string>(`browser.login.${s.id}`)),
              lastUsed: await this.app.kv.get<string>(`browser.used.${s.id}`),
            })),
          ),
        ),
      );
      api.post("/api/browser/login", async (c) => {
        const { site } = await body(c, z.object({ site: z.string() }));
        const s = SITE_LIST.find((x) => x.name === site || x.id === site);
        if (!s) throw new HttpError(404, "Unknown site");
        if (this.app.opts.dataDir === ":memory:")
          throw new HttpError(400, "The browser agent needs a data folder.");
        try {
          // Sign-in always happens in a visible window, by the user.
          const settings = await this.app.settings();
          if (settings.browserHeadless) await this.app.updateSettings({ browserHeadless: false });
          await openLoginWindow(await this.get(), s.id);
          await this.app.kv.set(`browser.login.${s.id}`, nowIso());
          await this.app.audit.log({
            kind: "connection.changed",
            summary: `Opened ${s.name} sign-in in the RelayIt browser`,
          });
        } catch (e) {
          throw new HttpError(400, errMessage(e));
        }
        return c.json({ ok: true });
      });
    };
  }
}

/* ───────────── Web research ───────────── */

export function startWeb(app: App) {
  app.registry.registerAll(createWebTools({ getExaKey: () => app.secrets.get("key.exa") }), "web");
}

/* ───────────── Voice ───────────── */

export function voiceRoutes(app: App): RouteModule {
  return (api) => {
    api.post("/api/voice/transcribe", async (c) => {
      const mime = c.req.header("content-type") ?? "audio/webm";
      const buf = Buffer.from(await c.req.arrayBuffer());
      if (buf.length < 1000) throw new HttpError(400, "That recording was too short.");
      if (buf.length > 25 * 1024 * 1024) throw new HttpError(413, "That recording is too long.");
      const model = await app.modelConfig();
      const providerKey =
        model?.provider === "openai" ? await app.secrets.get(app.keyName("openai")) : null;
      const { transcriber, message } = pickTranscriber({
        local: await detectLocalWhisper().catch(() => null),
        openaiKey: (await app.secrets.get("key.openai")) ?? providerKey,
        groqKey: await app.secrets.get("key.groq"),
      });
      if (!transcriber)
        throw new HttpError(
          400,
          message ?? "Voice needs local Whisper, or a Groq/OpenAI key in Connections → Extra keys.",
        );
      try {
        const r = await transcriber.transcribe(buf, mime, { language: "en" });
        return c.json({ text: r.text, engine: r.engine });
      } catch (e) {
        throw new HttpError(502, `Couldn't transcribe: ${errMessage(e)}`);
      }
    });
  };
}
