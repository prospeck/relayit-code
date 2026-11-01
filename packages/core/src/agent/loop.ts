import type {
  Message,
  MessagePart,
  PendingAction,
  Profile,
  Settings,
  ToolContext,
  ToolDef,
} from "@relayit/shared";
import type { ChatMessage, ModelProvider, ToolCall } from "../models/types.ts";
import { ModelError } from "../models/types.ts";
import { estimateCostInr } from "../models/pricing.ts";
import type { ToolRegistry, RegisteredTool } from "../tools/registry.ts";
import type {
  ActionRepo,
  AuditRepo,
  ChatRepo,
  KvRepo,
  MemoryRepo,
  SecretRepo,
  SkillRepo,
} from "../store/repo.ts";
import type { Database } from "../store/db.ts";
import { json, parse } from "../store/db.ts";
import type { EventBus } from "../events.ts";
import { newId, nowIso } from "../util/ids.ts";
import { errMessage, withTimeout } from "../util/time.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { routeDomains } from "./router.ts";
import { extractParts, stringifyResult, wrapUntrusted } from "./untrusted.ts";

export type ActiveModel = {
  provider: ModelProvider;
  providerId: string;
  model: string;
  routerModel: string | null;
};

type Step = {
  id: string;
  label: string;
  tool: string;
  status: "running" | "done" | "error" | "waiting";
};

export type RunState = {
  messages: ChatMessage[];
  domains: string[] | "all";
  step: number;
  tainted: boolean;
  queue: ToolCall[];
  waitingActionId: string | null;
  steps: Step[];
  text: string;
  parts: MessagePart[];
  usage: { inputTokens: number; outputTokens: number };
  invalidCalls: number;
  skill: string | null;
  endTurn: boolean;
  /** Hidden "carry on" prompts used this turn (small models often announce a step instead of taking it). */
  nudges?: number;
  /** Act tools the user refused in this run; calling them again is blocked until the next message. */
  refused?: string[];
};

export type ToolHook = {
  tools: string[];
  /** Runs after a tool succeeds. May add UI parts or replace what the model sees. */
  after(args: {
    output: unknown;
    input: unknown;
    ctx: ToolContext;
    tool: ToolDef;
  }): Promise<{ parts?: MessagePart[]; output?: unknown } | void>;
};

export type AgentDeps = {
  db: Database;
  chat: ChatRepo;
  actions: ActionRepo;
  audit: AuditRepo;
  memory: MemoryRepo;
  kv: KvRepo;
  secrets: SecretRepo;
  skills: SkillRepo;
  registry: ToolRegistry;
  bus: EventBus;
  getModel(): Promise<ActiveModel | null>;
  getProfile(): Promise<Profile | null>;
  getSettings(): Promise<Settings>;
  hooks?: ToolHook[];
  timeZone?: string;
  limits?: Partial<{
    maxSteps: number;
    toolTimeoutMs: number;
    actionTtlMs: number;
    historyMessages: number;
  }>;
  systemExtra?: () => Promise<string | undefined>;
};

const DEFAULT_LIMITS = {
  maxSteps: 14,
  toolTimeoutMs: 45_000,
  actionTtlMs: 30 * 60_000,
  historyMessages: 24,
};

export class Agent {
  private active = new Map<string, AbortController>();
  private limits: typeof DEFAULT_LIMITS;

  private d: AgentDeps;
  constructor(d: AgentDeps) {
    this.d = d;
    this.limits = { ...DEFAULT_LIMITS, ...d.limits };
  }

  isBusy(conversationId: string): boolean {
    return this.active.has(conversationId);
  }

  stop(conversationId: string): boolean {
    const c = this.active.get(conversationId);
    if (!c) return false;
    c.abort();
    return true;
  }

  /** Starts a new turn. Resolves when the run finishes or pauses for approval. */
  async send(
    conversationId: string,
    text: string,
    opts: { skill?: string | null; hidden?: boolean } = {},
  ): Promise<{ runId: string; userMessage: Message | null }> {
    if (this.active.has(conversationId)) throw new BusyError();
    // If the last turn ended by offering choices, continue that task with its full tool context
    // (exact IDs, domains, taint) instead of rebuilding history from display text.
    const previous = await this.d.db
      .selectFrom("agent_runs")
      .select(["state", "status"])
      .where("conversation_id", "=", conversationId)
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    const prior = previous?.status === "done" ? parse<RunState | null>(previous.state, null) : null;
    const continuing = !!prior?.endTurn && prior.messages.length < 80;
    const history = continuing ? prior!.messages : await this.history(conversationId);
    const userMessage = opts.hidden
      ? null
      : await this.d.chat.addMessage({
          conversationId,
          role: "user",
          parts: [{ type: "text", text }],
        });
    if (userMessage) this.d.bus.emit({ type: "message.created", message: userMessage });

    const runId = newId("run");
    const state: RunState = {
      messages: [...history, { role: "user", content: text }],
      domains: continuing ? prior!.domains : "all",
      step: 0,
      tainted: continuing ? prior!.tainted : false,
      queue: [],
      waitingActionId: null,
      steps: [],
      text: "",
      parts: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      invalidCalls: 0,
      skill: opts.skill ?? null,
      endTurn: false,
    };
    await this.d.db
      .insertInto("agent_runs")
      .values({
        id: runId,
        conversation_id: conversationId,
        status: "running",
        state: json(state),
        error: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      })
      .execute();
    await this.maybeTitle(conversationId, text);
    await this.drive(runId, conversationId, state, true);
    return { runId, userMessage };
  }

  /** Called after the user approves or refuses a pending action. */
  async resume(actionId: string): Promise<void> {
    const action = await this.d.actions.get(actionId);
    if (!action) throw new Error("Action not found");
    const run = await this.d.db
      .selectFrom("agent_runs")
      .selectAll()
      .where("id", "=", action.runId)
      .executeTakeFirst();
    if (!run || run.status !== "waiting_approval") return;
    const state = parse<RunState>(run.state, null as never);
    if (state.waitingActionId !== actionId) return;
    if (this.active.has(run.conversation_id)) throw new BusyError();

    const reg = this.d.registry.get(action.toolName);
    let content: string;
    let isError = false;
    if (action.status === "approved" && reg) {
      const r = await this.executeApproved(reg, action, run.conversation_id, action.runId, state);
      content = r.content;
      isError = r.isError;
      state.parts.push(...r.parts);
    } else if (action.status === "approved") {
      content = "The tool is no longer available (its connection was removed).";
      isError = true;
    } else if (action.status === "expired") {
      content = "The approval request expired before the user responded. Nothing was done.";
    } else {
      content = "The user refused this action. Nothing was done. Do not retry unless they ask.";
      state.refused = [...new Set([...(state.refused ?? []), action.toolName])];
    }
    state.messages.push({
      role: "tool",
      toolCallId: action.toolCallId,
      name: action.toolName,
      content,
      ...(isError ? { isError } : {}),
    });
    const stepIdx = state.steps.findIndex((s) => s.status === "waiting");
    if (stepIdx >= 0) {
      state.steps[stepIdx]!.status = action.status === "approved" && !isError ? "done" : "error";
      this.d.bus.emit({
        type: "run.step",
        runId: action.runId,
        conversationId: run.conversation_id,
        step: state.steps[stepIdx]!,
      });
    }
    state.waitingActionId = null;
    await this.save(action.runId, "running", state);
    await this.drive(action.runId, run.conversation_id, state, false);
  }

  /** Marks runs that were mid-flight when the app quit. */
  async recoverInterrupted(): Promise<void> {
    const rows = await this.d.db
      .selectFrom("agent_runs")
      .select(["id", "conversation_id"])
      .where("status", "=", "running")
      .execute();
    for (const r of rows) {
      await this.d.db
        .updateTable("agent_runs")
        .set({ status: "error", error: "Interrupted by app restart", updated_at: nowIso() })
        .where("id", "=", r.id)
        .execute();
      await this.d.chat.addMessage({
        conversationId: r.conversation_id,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "_I was interrupted when RelayIt closed. Ask me again and I'll pick it up._",
          },
        ],
      });
    }
  }

  /* ───────────── internals ───────────── */

  private async drive(
    runId: string,
    conversationId: string,
    state: RunState,
    fresh: boolean,
  ): Promise<void> {
    const ctrl = new AbortController();
    this.active.set(conversationId, ctrl);
    this.d.bus.emit({ type: "run.started", runId, conversationId });
    try {
      const model = await this.d.getModel();
      if (!model) throw new Error("No model is set up yet. Open Settings → Model to add one.");

      if (fresh) {
        this.status(runId, conversationId, "Understanding…");
        const lastUser = [...state.messages].reverse().find((m) => m.role === "user");
        const skill = state.skill ? await this.d.skills.getBySlug(state.skill) : null;
        if (skill?.domains.length) state.domains = skill.domains;
        else
          state.domains = await routeDomains({
            text: lastUser?.content ?? "",
            available: this.d.registry.domains(),
            totalTools: this.d.registry.forDomains("all").length,
            provider: model.routerModel ? model.provider : null,
            routerModel: model.routerModel,
            recentDomains: state.domains === "all" ? [] : state.domains,
          });
      }

      // Finish tool calls left over from before the pause.
      if (state.queue.length) {
        const paused = await this.processCalls(runId, conversationId, state, ctrl.signal);
        if (paused) return;
      }

      while (!state.endTurn && state.step < this.limits.maxSteps) {
        state.step++;
        const browserOn = (await this.d.getSettings()).browserAgentEnabled;
        const tools = this.d.registry
          .forDomains(state.domains)
          .filter((t) => browserOn || t.def.domain !== "browser");
        const skill = state.skill ? await this.d.skills.getBySlug(state.skill) : null;
        const system = buildSystemPrompt({
          profile: await this.d.getProfile(),
          memory: await this.d.memory.list(),
          now: new Date(),
          timeZone:
            this.d.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Asia/Kolkata",
          skill,
          domains: state.domains === "all" ? [] : state.domains,
          extra: (await this.d.systemExtra?.()) ?? undefined,
        });
        this.status(runId, conversationId, state.step === 1 ? "Thinking…" : "Working on it…");

        let text = "";
        const calls: ToolCall[] = [];
        try {
          for await (const ev of model.provider.stream({
            model: model.model,
            system,
            messages: state.messages,
            tools: this.d.registry.specs(tools),
            maxTokens: 4096,
            signal: ctrl.signal,
          })) {
            if (ev.type === "text") {
              text += ev.delta;
              this.d.bus.emit({ type: "run.text", runId, conversationId, delta: ev.delta });
            } else if (ev.type === "tool_call") calls.push(ev.call);
            else if (ev.type === "usage") {
              state.usage.inputTokens += ev.inputTokens;
              state.usage.outputTokens += ev.outputTokens;
            }
          }
          if (ctrl.signal.aborted) throw new StoppedError();
        } catch (e) {
          if (ctrl.signal.aborted) throw new StoppedError();
          if (e instanceof ModelError && e.retryable && state.step < 3) {
            this.status(runId, conversationId, "The model is busy, retrying…");
            await new Promise((r) => setTimeout(r, 1500));
            state.step--;
            continue;
          }
          throw e;
        }

        // Some small local models write the call as text ("tool_name {json}" or <tool_call>…</tool_call>).
        if (!calls.length && text) {
          const recovered = recoverTextToolCall(text, new Set(tools.map((t) => t.def.name)));
          if (recovered) {
            calls.push(recovered.call);
            text = recovered.text;
          }
        }
        if (text) state.text += (state.text && !state.text.endsWith("\n") ? "\n\n" : "") + text;
        state.messages.push({
          role: "assistant",
          content: text,
          ...(calls.length ? { toolCalls: calls } : {}),
        });

        if (!calls.length) {
          // "I'll search…/Let me…/Next I'll…" with no tool call: the model stopped mid-task. Nudge it once or twice.
          const nudge = nudgeFor(text, state.steps.length > 0, tools.map((t) => t.def.name));
          if (nudge && (state.nudges ?? 0) < 3) {
            state.nudges = (state.nudges ?? 0) + 1;
            // The narration was a misstep; keep it in the model's context but not in the user's reply.
            if (text && state.text.endsWith(text))
              state.text = state.text.slice(0, -text.length).trimEnd();
            state.messages.push({ role: "user", content: `[RelayIt] ${nudge}` });
            continue;
          }
          break;
        }
        // Copy: the queue is consumed, but the assistant message must keep its tool calls.
        state.queue = [...calls];
        const paused = await this.processCalls(runId, conversationId, state, ctrl.signal);
        if (paused) return;
        await this.save(runId, "running", state);
      }

      if (!state.endTurn && state.step >= this.limits.maxSteps) {
        state.text +=
          "\n\n_I hit my step limit for one request. Tell me to continue if you'd like me to keep going._";
      }
      await this.finish(runId, conversationId, state);
    } catch (e) {
      if (e instanceof StoppedError || ctrl.signal.aborted) {
        state.text += state.text ? "\n\n_Stopped._" : "_Stopped._";
        await this.finish(runId, conversationId, state);
        return;
      }
      const msg = errMessage(e);
      await this.d.db
        .updateTable("agent_runs")
        .set({ status: "error", error: msg, state: json(state), updated_at: nowIso() })
        .where("id", "=", runId)
        .execute();
      await this.d.audit.log({ kind: "error", summary: `Run failed: ${msg}`, conversationId });
      const message = await this.d.chat.addMessage({
        conversationId,
        role: "assistant",
        parts: [
          ...(state.text ? [{ type: "text" as const, text: state.text }] : []),
          { type: "text", text: `⚠️ ${msg}` },
        ],
      });
      this.d.bus.emit({ type: "message.created", message });
      this.d.bus.emit({ type: "run.error", runId, conversationId, error: msg });
    } finally {
      this.active.delete(conversationId);
    }
  }

  /** Processes queued tool calls. Returns true if the run paused for approval. */
  private async processCalls(
    runId: string,
    conversationId: string,
    state: RunState,
    signal: AbortSignal,
  ): Promise<boolean> {
    while (state.queue.length) {
      if (signal.aborted) throw new StoppedError();
      const call = state.queue.shift()!;
      const reg = this.d.registry.get(call.name);
      if (!reg || reg.internal) {
        this.toolError(state, call, `Unknown tool "${call.name}". Use only the tools provided.`);
        continue;
      }
      const tool = reg.def;
      const parsed = tool.input.safeParse(call.args);
      if (!parsed.success) {
        state.invalidCalls++;
        if (state.invalidCalls > 2)
          throw new Error(
            `I had trouble using ${tool.service} (the model kept sending invalid requests). Try rephrasing, or pick a stronger model in Settings.`,
          );
        this.toolError(
          state,
          call,
          `Invalid arguments for ${call.name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}. Fix them and call the tool again.`,
        );
        continue;
      }
      const input = parsed.data;
      // Yes/No "shall I proceed?" buttons are just asking permission in a different way.
      if (
        tool.name === "offer_quick_replies" &&
        isPermissionChoice(input as { question?: string; options: string[] })
      ) {
        this.toolError(
          state,
          call,
          "Don't ask yes/no permission. Call the action tool now (e.g. place_order, gmail_send, calendar_create_event); the user approves or refuses on the card it shows.",
        );
        continue;
      }
      const step: Step = {
        id: call.id,
        label: tool.label?.(input) ?? tool.name.replace(/_/g, " "),
        tool: tool.name,
        status: "running",
      };
      state.steps.push(step);
      this.d.bus.emit({ type: "run.step", runId, conversationId, step });

      if (tool.toolClass === "act" && state.refused?.includes(tool.name)) {
        this.toolError(
          state,
          call,
          "The user refused this action a moment ago. Don't call it again; tell them briefly what you'd do differently, or stop.",
        );
        continue;
      }
      if (tool.toolClass === "act") {
        const outcome = await this.requestApproval(runId, conversationId, state, reg, call, input);
        if (outcome.paused) {
          step.status = "waiting";
          this.d.bus.emit({ type: "run.step", runId, conversationId, step });
          await this.save(runId, "waiting_approval", state);
          await this.persistSegment(conversationId, state, outcome.action!);
          return true;
        }
        // Auto-approved by an "Always allow" rule.
        const r = await this.executeApproved(reg, outcome.action!, conversationId, runId, state);
        state.parts.push(...r.parts);
        step.status = r.isError ? "error" : "done";
        this.d.bus.emit({ type: "run.step", runId, conversationId, step });
        state.messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: r.content,
          ...(r.isError ? { isError: true } : {}),
        });
        continue;
      }

      const r = await this.runTool(
        reg,
        input,
        { conversationId, runId, idempotencyKey: null, signal },
        state,
      );
      step.status = r.isError ? "error" : "done";
      this.d.bus.emit({ type: "run.step", runId, conversationId, step });
      state.messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: r.content,
        ...(r.isError ? { isError: true } : {}),
      });
      state.parts.push(...r.parts);
      if (tool.name === "offer_quick_replies" && !r.isError) {
        // Choices end the turn: the user's tap is the next message.
        state.endTurn = true;
        for (const rest of state.queue.splice(0))
          this.toolError(state, rest, "Skipped: the turn ended to wait for the user's choice.");
      }
    }
    return false;
  }

  private toolError(state: RunState, call: ToolCall, message: string) {
    state.messages.push({
      role: "tool",
      toolCallId: call.id,
      name: call.name,
      content: message,
      isError: true,
    });
  }

  private async requestApproval(
    runId: string,
    conversationId: string,
    state: RunState,
    reg: RegisteredTool,
    call: ToolCall,
    input: unknown,
  ): Promise<{ paused: boolean; action?: PendingAction & { toolCallId: string } }> {
    const tool = reg.def;
    const settings = await this.d.getSettings();
    const ctx = await this.context(
      conversationId,
      runId,
      null,
      AbortSignal.timeout(this.limits.toolTimeoutMs),
      state,
    );
    let preview;
    try {
      preview = tool.preview ? await tool.preview(input, ctx) : null;
    } catch (e) {
      preview = null;
      await this.d.audit.log({
        kind: "error",
        summary: `Couldn't build the approval card for ${tool.name}: ${errMessage(e)}`,
        toolName: tool.name,
        conversationId,
      });
    }
    preview ??= {
      title: `Allow ${tool.service} to ${tool.name.replace(/_/g, " ")}`,
      summary: "RelayIt wants to run this action.",
      service: tool.service,
      details: summariseArgs(input),
    };
    const known = await this.knownFactsUsed(input, preview);
    if (known.length)
      preview = {
        ...preview,
        details: [
          ...(preview.details ?? []),
          { label: "From what I know", value: known.join(" · ") },
        ],
      };
    const money =
      (typeof tool.involvesMoney === "function"
        ? tool.involvesMoney(input)
        : !!tool.involvesMoney) || (preview.amountInr ?? 0) > 0;
    const action: PendingAction & { toolCallId: string } = {
      id: newId("act"),
      runId,
      conversationId,
      toolName: tool.name,
      toolCallId: call.id,
      title: preview.title,
      summary: preview.summary,
      service: preview.service || tool.service,
      recipient: preview.recipient ?? null,
      amountInr: preview.amountInr ?? null,
      details: preview.details ?? [],
      payload: input,
      status: "pending",
      tainted: state.tainted,
      involvesMoney: money,
      spendCapInr: money ? settings.spendCapInr : null,
      idempotencyKey: newId("idem"),
      expiresAt: new Date(Date.now() + this.limits.actionTtlMs).toISOString(),
      createdAt: nowIso(),
      resolvedAt: null,
      result: null,
    };

    const ruled = await this.d.actions.hasRule(tool.name);
    const auto = ruled && !money && !state.tainted;
    if (auto) {
      action.status = "approved";
      action.resolvedAt = nowIso();
      await this.d.actions.insert(action);
      await this.d.audit.log({
        kind: "action.approved",
        summary: `Auto-approved by your "Always allow" rule: ${action.title}`,
        toolName: tool.name,
        toolClass: "act",
        data: { actionId: action.id },
        conversationId,
      });
      return { paused: false, action };
    }
    await this.d.actions.insert(action);
    state.waitingActionId = action.id;
    await this.d.audit.log({
      kind: "action.created",
      summary: `Waiting for approval: ${action.title}${action.amountInr ? ` (₹${action.amountInr})` : ""}${ruled && (money || state.tainted) ? ` — "Always allow" skipped because ${money ? "money is involved" : "outside content was read in this task"}` : ""}`,
      toolName: tool.name,
      toolClass: "act",
      data: { actionId: action.id, payload: input },
      conversationId,
    });
    this.d.bus.emit({ type: "action.pending", action });
    this.d.bus.emit({
      type: "notify",
      kind: "needs_you",
      title: "RelayIt needs your OK",
      body: action.title,
    });
    return { paused: true, action };
  }

  /** Names the saved facts an action relied on, so the card shows where defaults came from. */
  private async knownFactsUsed(
    input: unknown,
    preview: { details?: { value: string }[] },
  ): Promise<string[]> {
    const hay =
      `${JSON.stringify(input)} ${(preview.details ?? []).map((d) => d.value).join(" ")}`.toLowerCase();
    const out: string[] = [];
    const profile = await this.d.getProfile();
    for (const a of profile?.addresses ?? []) {
      const line = a.line.toLowerCase().trim();
      if (line.length >= 6 && hay.includes(line)) out.push(`your ${a.label} address`);
    }
    for (const f of await this.d.memory.list()) {
      const words = f.value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 5);
      const hits = words.filter((w) => hay.includes(w)).length;
      if (words.length && hits >= Math.min(2, words.length)) out.push(f.key);
    }
    return [...new Set(out)].slice(0, 3);
  }

  private async executeApproved(
    reg: RegisteredTool,
    action: PendingAction & { toolCallId: string },
    conversationId: string,
    runId: string,
    state: RunState,
  ) {
    // Idempotency: an action that already executed returns its stored result.
    if (action.status === "executed") {
      return {
        content: wrapUntrusted(`tool:${reg.def.name}`, stringifyResult(action.result)),
        isError: false,
        parts: [] as MessagePart[],
      };
    }
    const r = await this.runTool(
      reg,
      action.payload,
      {
        conversationId,
        runId,
        idempotencyKey: action.idempotencyKey,
        signal: new AbortController().signal,
      },
      state,
    );
    await this.d.actions.update(action.id, {
      status: r.isError ? "failed" : "executed",
      result: r.raw,
    });
    const updated = await this.d.actions.get(action.id);
    if (updated) this.d.bus.emit({ type: "action.updated", action: updated });
    await this.d.audit.log({
      kind: r.isError ? "action.failed" : "action.executed",
      summary: `${r.isError ? "Failed" : "Done"}: ${action.title}`,
      toolName: reg.def.name,
      toolClass: "act",
      data: { actionId: action.id, result: r.raw },
      conversationId,
    });
    if (!r.isError)
      this.d.bus.emit({
        type: "notify",
        kind: action.involvesMoney ? "order" : "info",
        title: action.title,
        body: "Done.",
      });
    return r;
  }

  private async runTool(
    reg: RegisteredTool,
    input: unknown,
    c: {
      conversationId: string;
      runId: string;
      idempotencyKey: string | null;
      signal: AbortSignal;
    },
    state: RunState,
  ): Promise<{ content: string; isError: boolean; parts: MessagePart[]; raw: unknown }> {
    const tool = reg.def;
    const label = tool.label?.(input as never);
    if (label) this.status(c.runId, c.conversationId, `${label}…`);
    const human = label ?? tool.name.replace(/_/g, " ").replace(/^./, (ch) => ch.toUpperCase());
    await this.d.audit.log({
      kind: "tool.call",
      summary: `${tool.service}: ${human}`,
      toolName: tool.name,
      toolClass: tool.toolClass,
      data: { input },
      conversationId: c.conversationId,
    });
    try {
      const ctx = await this.context(c.conversationId, c.runId, c.idempotencyKey, c.signal, state);
      let output = await withTimeout(
        tool.name,
        tool.timeoutMs ?? this.limits.toolTimeoutMs,
        (signal) => tool.run(input, { ...ctx, signal: anySignal([signal, c.signal]) }),
      );
      const parts: MessagePart[] = [];
      const extracted = extractParts(output);
      output = extracted.value;
      parts.push(...(extracted.parts as MessagePart[]));
      if (tool.toParts) parts.push(...tool.toParts(output, input as never));
      for (const hook of this.d.hooks ?? []) {
        if (!hook.tools.includes(tool.name)) continue;
        const h = await hook.after({ output, input, ctx, tool });
        if (h?.parts) parts.push(...h.parts);
        if (h?.output !== undefined) output = h.output;
      }
      if (tool.untrustedOutput) state.tainted = true;
      await this.d.audit.log({
        kind: "tool.result",
        summary: `${tool.service}: ${human} — done`,
        toolName: tool.name,
        toolClass: tool.toolClass,
        data: { output },
        conversationId: c.conversationId,
      });
      return {
        content: wrapUntrusted(`tool:${tool.name}`, stringifyResult(output)),
        isError: false,
        parts,
        raw: output,
      };
    } catch (e) {
      const msg = errMessage(e);
      await this.d.audit.log({
        kind: "error",
        summary: `${tool.service}: ${human} — failed: ${msg}`,
        toolName: tool.name,
        toolClass: tool.toolClass,
        conversationId: c.conversationId,
      });
      return { content: `Tool error: ${msg}`, isError: true, parts: [], raw: { error: msg } };
    }
  }

  private async context(
    conversationId: string,
    runId: string,
    idempotencyKey: string | null,
    signal: AbortSignal,
    _state: RunState,
  ): Promise<ToolContext> {
    return {
      conversationId,
      runId,
      signal,
      idempotencyKey,
      profile: await this.d.getProfile(),
      memory: await this.d.memory.list(),
      secrets: {
        get: (n) => this.d.secrets.get(n),
        set: (n, v) => this.d.secrets.set(n, v),
        delete: (n) => this.d.secrets.delete(n),
      },
      kv: { get: (k) => this.d.kv.get(k), set: (k, v) => this.d.kv.set(k, v) },
      status: (label) => this.status(runId, conversationId, label),
    };
  }

  private status(runId: string, conversationId: string, label: string) {
    this.d.bus.emit({ type: "run.status", runId, conversationId, label });
  }

  /** Writes the text so far plus the approval card into the conversation. */
  private async persistSegment(conversationId: string, state: RunState, action: PendingAction) {
    const parts: MessagePart[] = [];
    if (state.text.trim()) parts.push({ type: "text", text: state.text.trim() });
    parts.push(...state.parts);
    if (state.steps.length)
      parts.push({
        type: "steps",
        steps: state.steps.map(({ label, tool, status }) => ({ label, tool, status })),
      });
    parts.push({ type: "action", actionId: action.id });
    const message = await this.d.chat.addMessage({ conversationId, role: "assistant", parts });
    this.d.bus.emit({ type: "message.created", message });
    state.text = "";
    state.parts = [];
    state.steps = state.steps.map((s) => ({ ...s }));
    await this.save(action.runId, "waiting_approval", state);
    this.d.bus.emit({ type: "run.finished", runId: action.runId, conversationId });
  }

  private async finish(runId: string, conversationId: string, state: RunState) {
    const model = await this.d.getModel();
    const parts: MessagePart[] = [];
    if (state.text.trim()) parts.push({ type: "text", text: state.text.trim() });
    parts.push(...state.parts);
    const visibleSteps = state.steps.filter(
      (s) => s.tool !== "offer_quick_replies" && s.status !== "waiting",
    );
    if (visibleSteps.length)
      parts.unshift({
        type: "steps",
        steps: visibleSteps.map(({ label, tool, status }) => ({ label, tool, status })),
      });
    if (!parts.length) parts.push({ type: "text", text: "Done." });
    const usage = model
      ? {
          ...state.usage,
          costInr: estimateCostInr(
            model.providerId,
            model.model,
            state.usage.inputTokens,
            state.usage.outputTokens,
          ),
        }
      : null;
    const message = await this.d.chat.addMessage({
      conversationId,
      role: "assistant",
      parts,
      usage,
    });
    this.d.bus.emit({ type: "message.created", message });
    await this.save(runId, "done", state);
    this.d.bus.emit({ type: "run.finished", runId, conversationId });
  }

  private async save(runId: string, status: string, state: RunState) {
    await this.d.db
      .updateTable("agent_runs")
      .set({ status, state: json(state), updated_at: nowIso() })
      .where("id", "=", runId)
      .execute();
  }

  private async history(conversationId: string): Promise<ChatMessage[]> {
    const msgs = await this.d.chat.listMessages(conversationId);
    const out: ChatMessage[] = [];
    for (const m of msgs.slice(-this.limits.historyMessages)) {
      const text = m.parts
        .map((p) => {
          if (p.type === "text") return p.text;
          if (p.type === "choices") return `[Offered choices: ${p.options.join(" | ")}]`;
          if (p.type === "action") return "[Showed an approval card]";
          if (p.type === "payment") return `[Showed a UPI payment request for ₹${p.amountInr}]`;
          if (p.type === "link") return `[Link: ${p.title} ${p.url}]`;
          return "";
        })
        .filter(Boolean)
        .join("\n");
      if (!text) continue;
      const last = out[out.length - 1];
      if (last && last.role === m.role) (last as { content: string }).content += `\n\n${text}`;
      else
        out.push(
          m.role === "user"
            ? { role: "user", content: text }
            : { role: "assistant", content: text },
        );
    }
    while (out[0]?.role === "assistant") out.shift();
    return out;
  }

  private async maybeTitle(conversationId: string, text: string) {
    const conv = await this.d.chat.getConversation(conversationId);
    if (!conv || conv.title !== "New chat") return;
    const title = text
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\/[a-z0-9-]+\s*/, "");
    const short = title.length > 48 ? `${title.slice(0, 46).trimEnd()}…` : title || "New chat";
    await this.d.chat.renameConversation(
      conversationId,
      short.charAt(0).toUpperCase() + short.slice(1),
    );
    const updated = await this.d.chat.getConversation(conversationId);
    if (updated) this.d.bus.emit({ type: "conversation.updated", conversation: updated });
  }
}

/**
 * Small models often stop a task by describing it. Spot the common patterns and say what to do instead.
 * Returns null when the reply is a real ending (an answer, or a genuine question).
 */
export function nudgeFor(text: string, usedTools: boolean, available: string[] = []): string | null {
  const t = text.trim();
  if (!t) return null;
  // "I don't have access to your emails/calendar" while the tools are right there.
  if (/\b(don'?t|do not|can'?t|cannot|unable to)\b[^.]{0,30}\b(have )?access\b|\bno access\b/i.test(t)) {
    const useful = available.filter((n) => /^(gmail_|calendar_|search_|find_|web_|browser_open)/.test(n)).slice(0, 8);
    if (useful.length) return `You do have access through your tools (${useful.join(", ")}). Use them now instead of saying you can't.`;
  }
  if (
    usedTools &&
    (/\b(would you like me to|shall i|should i|do you want me to|want me to)\b[^.?!]{0,40}\b(proceed|place|book|send|confirm|go ahead|order|create|schedule)/i.test(
      t,
    ) ||
      /\b(please confirm|confirm when|ready to proceed|confirm (?:and|to) (?:place|send|book))\b/i.test(
        t,
      ))
  )
    return "Don't ask for permission in text. Call the action tool now (e.g. place_order, gmail_send, calendar_create_event) — that shows the user an approval card where they decide.";
  if (/\boffer_quick_replies\b|^\s*\[[^\]]{2,60}\]\s*$|^\s*\(?options?:/im.test(t))
    return "Don't write choices as text. Call the offer_quick_replies tool with the options instead.";
  if (
    usedTools &&
    /\b(i'll|i will|let me(?! know)|next,? i|i'm going to|i am going to|now i)\b/i.test(
      t.slice(-400),
    ) &&
    !/\?$/.test(t)
  )
    return "Carry out that next step now with the tools instead of describing it. If you genuinely need the user's choice, call offer_quick_replies.";
  return null;
}

export function isPermissionChoice(input: { question?: string; options: string[] }): boolean {
  const yesNo = input.options.every((o) =>
    /^(yes|no|ok|okay|sure|proceed|go ahead|confirm|cancel|place (the |this )?order|don'?t)\b/i.test(
      o.trim(),
    ),
  );
  const about = /\b(proceed|place|order|send|book|confirm|go ahead|schedule|create)\b/i.test(
    `${input.question ?? ""} ${input.options.join(" ")}`,
  );
  return yesNo && about;
}

export function recoverTextToolCall(
  text: string,
  names: Set<string>,
): { call: ToolCall; text: string } | null {
  const patterns = [
    /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>\s*$/,
    /(?:^|\n)\s*`{0,3}(?:json)?\s*([a-z][a-z0-9_]{2,63})\s*\n?\s*(\{[\s\S]*\})\s*`{0,3}\s*$/,
  ];
  // "offer_quick_replies" followed by a bullet list of options (YAML-ish), no JSON.
  const listed = /offer_quick_replies[\s\S]*?options:?\s*\n((?:\s*[-*•]\s*.+\n?){2,4})\s*$/i.exec(text);
  if (listed && names.has("offer_quick_replies")) {
    const options = listed[1]!.split("\n").map((l) => l.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean).slice(0, 4);
    const args = { options };
    return {
      call: { id: `text_${Math.random().toString(36).slice(2, 10)}`, name: "offer_quick_replies", args, rawArgs: JSON.stringify(args) },
      text: text.slice(0, text.search(/offer_quick_replies/i)).trimEnd(),
    };
  }
  for (const re of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    try {
      let name: string;
      let args: unknown;
      if (m.length === 2) {
        const obj = JSON.parse(m[1]!) as { name?: string; arguments?: unknown };
        name = obj.name ?? "";
        args = obj.arguments ?? {};
      } else {
        name = m[1]!;
        args = JSON.parse(m[2]!);
      }
      if (!names.has(name)) continue;
      return {
        call: {
          id: `text_${Math.random().toString(36).slice(2, 10)}`,
          name,
          args,
          rawArgs: JSON.stringify(args),
        },
        text: text.slice(0, m.index).trimEnd(),
      };
    } catch {
      /* not JSON — leave the text alone */
    }
  }
  return null;
}

export class BusyError extends Error {
  constructor() {
    super("RelayIt is still working on the last request in this chat.");
  }
}
class StoppedError extends Error {}

function anySignal(signals: AbortSignal[]): AbortSignal {
  return AbortSignal.any(signals);
}

function summariseArgs(input: unknown) {
  if (!input || typeof input !== "object") return [];
  return Object.entries(input as Record<string, unknown>)
    .filter(([k]) => k !== "idempotencyKey")
    .slice(0, 8)
    .map(([k, v]) => ({
      label: k
        .replace(/([A-Z])/g, " $1")
        .replace(/_/g, " ")
        .replace(/^./, (c) => c.toUpperCase()),
      value: typeof v === "string" ? v : JSON.stringify(v),
    }));
}
