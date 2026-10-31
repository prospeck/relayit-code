import { join } from "node:path";
import { Settings as SettingsSchema, type AppState, type ModelConfig, type PendingAction, type Profile, type Settings } from "@relayit/shared";
import { openDatabase, type Database } from "./store/db.ts";
import { ActionRepo, AuditRepo, ChatRepo, KvRepo, MemoryRepo, RoutineRepo, SecretRepo, SkillRepo, TaskRepo } from "./store/repo.ts";
import { Redactor } from "./audit/redact.ts";
import { EventBus } from "./events.ts";
import { ToolRegistry } from "./tools/registry.ts";
import { coreTools, demoTools } from "./tools/builtin.ts";
import { Agent, type ActiveModel, type ToolHook } from "./agent/loop.ts";
import { createProvider, suggestRouterModel } from "./models/index.ts";
import type { ModelProvider } from "./models/types.ts";
import type { KeyProvider } from "./crypto/keyProvider.ts";
import { nowIso } from "./util/ids.ts";

export const VERSION = "0.1.0";

export type AppOptions = {
  dataDir: string;
  keyProvider: KeyProvider;
  /** Use the offline scripted model (tests, CI, demo). */
  mockModel?: boolean;
  /** Point Google tools at the local fake Google server. */
  fakeGoogleUrl?: string | null;
  /** Override the model provider entirely (tests). */
  providerOverride?: ModelProvider;
  timeZone?: string;
};

export class App {
  readonly bus = new EventBus();
  readonly redactor = new Redactor();
  readonly registry = new ToolRegistry();
  db!: Database;
  kv!: KvRepo;
  secrets!: SecretRepo;
  chat!: ChatRepo;
  actions!: ActionRepo;
  audit!: AuditRepo;
  tasks!: TaskRepo;
  memory!: MemoryRepo;
  skills!: SkillRepo;
  routines!: RoutineRepo;
  agent!: Agent;
  readonly hooks: ToolHook[] = [];
  private timers: NodeJS.Timeout[] = [];
  private shutdownHooks: (() => Promise<void> | void)[] = [];
  private systemExtras: (() => Promise<string | undefined>)[] = [];

  readonly opts: AppOptions;
  constructor(opts: AppOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    const masterKey = await this.opts.keyProvider.getMasterKey();
    this.db = await openDatabase(this.opts.dataDir === ":memory:" ? ":memory:" : join(this.opts.dataDir, "relayit.db"));
    this.kv = new KvRepo(this.db);
    this.secrets = new SecretRepo(this.db, masterKey, this.redactor);
    this.chat = new ChatRepo(this.db);
    this.actions = new ActionRepo(this.db);
    this.audit = new AuditRepo(this.db, this.redactor, this.bus);
    this.tasks = new TaskRepo(this.db);
    this.memory = new MemoryRepo(this.db);
    this.skills = new SkillRepo(this.db);
    this.routines = new RoutineRepo(this.db);
    await this.secrets.primeRedactor();

    this.registry.registerAll(coreTools({ memory: this.memory }));
    this.registry.registerAll(demoTools());

    this.agent = new Agent({
      db: this.db, chat: this.chat, actions: this.actions, audit: this.audit, memory: this.memory, kv: this.kv,
      secrets: this.secrets, skills: this.skills, registry: this.registry, bus: this.bus,
      getModel: () => this.activeModel(),
      getProfile: () => this.profile(),
      getSettings: () => this.settings(),
      hooks: this.hooks,
      timeZone: this.opts.timeZone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata"),
      systemExtra: async () => (await Promise.all(this.systemExtras.map((f) => f().catch(() => undefined)))).filter(Boolean).join("\n\n") || undefined,
    });
    await this.agent.recoverInterrupted();

    // Expire stale approvals and let their runs wrap up.
    this.every(60_000, async () => {
      for (const a of await this.actions.expireDue()) {
        await this.audit.log({ kind: "action.expired", summary: `Expired without a response: ${a.title}`, toolName: a.toolName, toolClass: "act", conversationId: a.conversationId });
        this.bus.emit({ type: "action.updated", action: a });
        await this.agent.resume(a.id).catch(() => {});
      }
    });
  }

  every(ms: number, fn: () => Promise<void>): void {
    const t = setInterval(() => void fn().catch((e) => console.error("[timer]", e)), ms);
    t.unref();
    this.timers.push(t);
  }

  onShutdown(fn: () => Promise<void> | void): void {
    this.shutdownHooks.push(fn);
  }

  addSystemExtra(fn: () => Promise<string | undefined>): void {
    this.systemExtras.push(fn);
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    for (const fn of this.shutdownHooks) await Promise.resolve(fn()).catch(() => {});
    await this.db?.destroy();
  }

  /* ───────────── settings & state ───────────── */

  async profile(): Promise<Profile | null> {
    return this.kv.get<Profile>("profile");
  }

  async settings(): Promise<Settings> {
    return SettingsSchema.parse((await this.kv.get<Partial<Settings>>("settings")) ?? {});
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    const next = SettingsSchema.parse({ ...(await this.settings()), ...patch });
    await this.kv.set("settings", next);
    await this.audit.log({ kind: "settings.changed", summary: `Settings updated: ${Object.keys(patch).join(", ")}`, data: patch });
    return next;
  }

  async modelConfig(): Promise<ModelConfig | null> {
    return this.kv.get<ModelConfig>("model");
  }

  keyName(provider: string): string {
    return `model.apiKey.${provider}`;
  }

  async state(): Promise<AppState> {
    const model = await this.modelConfig();
    return {
      onboarded: (await this.kv.get<boolean>("onboarded")) ?? false,
      profile: await this.profile(),
      model,
      keySaved: model ? model.provider === "ollama" || (await this.secrets.has(this.keyName(model.provider))) : false,
      settings: await this.settings(),
      version: VERSION,
      mockMode: { model: !!this.opts.mockModel, google: !!this.opts.fakeGoogleUrl },
    };
  }

  private modelCache: { key: string; active: ActiveModel } | null = null;

  async activeModel(): Promise<ActiveModel | null> {
    if (this.opts.providerOverride) return { provider: this.opts.providerOverride, providerId: "mock", model: "test", routerModel: null };
    if (this.opts.mockModel) return { provider: createProvider("mock", null), providerId: "mock", model: "mock-smart", routerModel: null };
    const cfg = await this.modelConfig();
    if (!cfg) return null;
    const apiKey = cfg.provider === "ollama" ? null : await this.secrets.get(this.keyName(cfg.provider));
    if (cfg.provider !== "ollama" && !apiKey) return null;
    const cacheKey = `${cfg.provider}|${cfg.model}|${cfg.baseUrl ?? ""}|${cfg.routerModel ?? ""}|${apiKey?.slice(-6) ?? ""}`;
    if (this.modelCache?.key === cacheKey) return this.modelCache.active;
    const provider = createProvider(cfg.provider, apiKey, cfg.baseUrl);
    const active: ActiveModel = { provider, providerId: cfg.provider, model: cfg.model, routerModel: cfg.routerModel ?? null };
    this.modelCache = { key: cacheKey, active };
    return active;
  }

  async saveModel(cfg: ModelConfig, apiKey?: string, available: string[] = []): Promise<void> {
    if (apiKey) {
      await this.secrets.set(this.keyName(cfg.provider), apiKey.trim());
      await this.audit.log({ kind: "secret.saved", summary: `API key saved for ${cfg.provider}` });
    }
    const routerModel = suggestRouterModel(cfg, available);
    await this.kv.set("model", { ...cfg, ...(routerModel ? { routerModel } : {}) });
    this.modelCache = null;
  }

  /* ───────────── approvals ───────────── */

  async approve(id: string, mode: "once" | "always"): Promise<PendingAction> {
    const a = await this.actions.get(id);
    if (!a) throw new HttpError(404, "That request no longer exists.");
    if (a.status !== "pending") throw new HttpError(409, `This request was already ${a.status}.`);
    if (a.expiresAt < nowIso()) {
      await this.actions.transition(id, "pending", "expired");
      void this.agent.resume(id).catch(() => {});
      throw new HttpError(410, "This request expired. Ask RelayIt again.");
    }
    if (a.involvesMoney && a.amountInr != null) {
      const cap = (await this.settings()).spendCapInr;
      if (a.amountInr > cap) throw new HttpError(422, `₹${a.amountInr} is above your ₹${cap} per-action limit. Raise it in Settings → Approvals to continue.`);
    }
    if (!(await this.actions.transition(id, "pending", "approved"))) throw new HttpError(409, "This request was already handled.");
    let rule = "";
    if (mode === "always" && !a.involvesMoney) {
      await this.actions.addRule(a.toolName, a.service, ruleLabel(a));
      rule = " and added an “Always allow” rule";
    }
    await this.audit.log({ kind: "action.approved", summary: `You approved${rule}: ${a.title}`, toolName: a.toolName, toolClass: "act", data: { actionId: id, mode }, conversationId: a.conversationId });
    const updated = (await this.actions.get(id))!;
    this.bus.emit({ type: "action.updated", action: updated });
    void this.agent.resume(id).catch((e) => console.error("[resume]", e));
    return updated;
  }

  async refuse(id: string): Promise<PendingAction> {
    const a = await this.actions.get(id);
    if (!a) throw new HttpError(404, "That request no longer exists.");
    if (!(await this.actions.transition(id, "pending", "refused"))) throw new HttpError(409, `This request was already ${a.status}.`);
    await this.audit.log({ kind: "action.refused", summary: `You refused: ${a.title}`, toolName: a.toolName, toolClass: "act", data: { actionId: id }, conversationId: a.conversationId });
    const updated = (await this.actions.get(id))!;
    this.bus.emit({ type: "action.updated", action: updated });
    void this.agent.resume(id).catch((e) => console.error("[resume]", e));
    return updated;
  }
}

function ruleLabel(a: PendingAction): string {
  const verb = a.toolName.replace(/_/g, " ");
  return `${a.service}: ${verb}`;
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
