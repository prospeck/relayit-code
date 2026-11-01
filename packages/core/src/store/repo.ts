import type {
  ApprovalRule,
  AuditEvent,
  Conversation,
  MemoryFact,
  MemoryFactInput,
  Message,
  MessagePart,
  PendingAction,
  Routine,
  RoutineInput,
  RoutineRun,
  Skill,
  SkillInput,
  Task,
  TaskStatus,
  ToolClass,
} from "@relayit/shared";
import type { Database } from "./db.ts";
import { json, parse } from "./db.ts";
import type { PendingActionTable } from "./schema.ts";
import { newId, nowIso } from "../util/ids.ts";
import { encrypt, decrypt } from "../crypto/secretbox.ts";
import type { Redactor } from "../audit/redact.ts";
import type { EventBus } from "../events.ts";

/* ───────────── KV ───────────── */

export class KvRepo {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  async get<T>(key: string): Promise<T | null> {
    const row = await this.db
      .selectFrom("kv")
      .select("value")
      .where("key", "=", key)
      .executeTakeFirst();
    return row ? parse<T | null>(row.value, null) : null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    await this.db
      .insertInto("kv")
      .values({ key, value: json(value), updated_at: nowIso() })
      .onConflict((oc) =>
        oc.column("key").doUpdateSet({ value: json(value), updated_at: nowIso() }),
      )
      .execute();
  }
  async delete(key: string): Promise<void> {
    await this.db.deleteFrom("kv").where("key", "=", key).execute();
  }
}

/* ───────────── Secrets (write-only from the UI's point of view) ───────────── */

export class SecretRepo {
  private db: Database;
  private masterKey: Buffer;
  private redactor: Redactor;
  constructor(db: Database, masterKey: Buffer, redactor: Redactor) {
    this.db = db;
    this.masterKey = masterKey;
    this.redactor = redactor;
  }

  async set(name: string, value: string): Promise<void> {
    const blob = encrypt(this.masterKey, value, `secret:${name}`);
    await this.db
      .insertInto("secrets")
      .values({ name, blob, updated_at: nowIso() })
      .onConflict((oc) => oc.column("name").doUpdateSet({ blob, updated_at: nowIso() }))
      .execute();
    this.redactor.remember(value);
  }

  async get(name: string): Promise<string | null> {
    const row = await this.db
      .selectFrom("secrets")
      .select("blob")
      .where("name", "=", name)
      .executeTakeFirst();
    if (!row) return null;
    const value = decrypt(this.masterKey, row.blob, `secret:${name}`);
    this.redactor.remember(value);
    return value;
  }

  async has(name: string): Promise<boolean> {
    const row = await this.db
      .selectFrom("secrets")
      .select("name")
      .where("name", "=", name)
      .executeTakeFirst();
    return !!row;
  }

  async delete(name: string): Promise<void> {
    const value = await this.get(name).catch(() => null);
    if (value) this.redactor.forget(value);
    await this.db.deleteFrom("secrets").where("name", "=", name).execute();
  }

  /** Load every secret once at boot so the redactor knows all values. */
  async primeRedactor(): Promise<void> {
    const rows = await this.db.selectFrom("secrets").select("name").execute();
    for (const r of rows) await this.get(r.name).catch(() => null);
  }
}

/* ───────────── Conversations & messages ───────────── */

export class ChatRepo {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  async createConversation(
    title: string,
    kind: Conversation["kind"] = "chat",
  ): Promise<Conversation> {
    const c: Conversation = {
      id: newId("conv"),
      title,
      kind,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.db
      .insertInto("conversations")
      .values({
        id: c.id,
        title: c.title,
        kind: c.kind,
        created_at: c.createdAt,
        updated_at: c.updatedAt,
      })
      .execute();
    return c;
  }

  async listConversations(limit = 100): Promise<Conversation[]> {
    const rows = await this.db
      .selectFrom("conversations")
      .selectAll()
      .orderBy("updated_at", "desc")
      .limit(limit)
      .execute();
    return rows.map(toConversation);
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const row = await this.db
      .selectFrom("conversations")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row ? toConversation(row) : null;
  }

  async renameConversation(id: string, title: string): Promise<void> {
    await this.db
      .updateTable("conversations")
      .set({ title, updated_at: nowIso() })
      .where("id", "=", id)
      .execute();
  }

  async touch(id: string): Promise<void> {
    await this.db
      .updateTable("conversations")
      .set({ updated_at: nowIso() })
      .where("id", "=", id)
      .execute();
  }

  async deleteConversation(id: string): Promise<void> {
    await this.db.deleteFrom("conversations").where("id", "=", id).execute();
  }

  async addMessage(m: Omit<Message, "id" | "createdAt"> & { id?: string }): Promise<Message> {
    const msg: Message = { ...m, id: m.id ?? newId("msg"), createdAt: nowIso() };
    await this.db
      .insertInto("messages")
      .values({
        id: msg.id,
        conversation_id: msg.conversationId,
        role: msg.role,
        parts: json(msg.parts),
        usage: msg.usage ? json(msg.usage) : null,
        created_at: msg.createdAt,
      })
      .execute();
    await this.touch(msg.conversationId);
    return msg;
  }

  async updateMessageParts(id: string, parts: MessagePart[]): Promise<void> {
    await this.db
      .updateTable("messages")
      .set({ parts: json(parts) })
      .where("id", "=", id)
      .execute();
  }

  async listMessages(conversationId: string): Promise<Message[]> {
    const rows = await this.db
      .selectFrom("messages")
      .selectAll()
      .where("conversation_id", "=", conversationId)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      role: r.role as Message["role"],
      parts: parse<MessagePart[]>(r.parts, []),
      createdAt: r.created_at,
      usage: parse(r.usage, null),
    }));
  }
}

const toConversation = (r: {
  id: string;
  title: string;
  kind: string;
  created_at: string;
  updated_at: string;
}): Conversation => ({
  id: r.id,
  title: r.title,
  kind: r.kind as Conversation["kind"],
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/* ───────────── Pending actions & approval rules ───────────── */

export class ActionRepo {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  async insert(a: PendingAction & { toolCallId: string }): Promise<void> {
    await this.db
      .insertInto("pending_actions")
      .values({
        id: a.id,
        run_id: a.runId,
        conversation_id: a.conversationId,
        tool_name: a.toolName,
        tool_call_id: a.toolCallId,
        title: a.title,
        summary: a.summary,
        service: a.service,
        recipient: a.recipient,
        amount_inr: a.amountInr,
        details: json(a.details),
        payload: json(a.payload),
        status: a.status,
        tainted: a.tainted ? 1 : 0,
        involves_money: a.involvesMoney ? 1 : 0,
        spend_cap_inr: a.spendCapInr,
        idempotency_key: a.idempotencyKey,
        expires_at: a.expiresAt,
        created_at: a.createdAt,
        resolved_at: a.resolvedAt,
        result: a.result == null ? null : json(a.result),
      })
      .execute();
  }

  async get(id: string): Promise<(PendingAction & { toolCallId: string }) | null> {
    const row = await this.db
      .selectFrom("pending_actions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row ? toAction(row) : null;
  }

  async list(
    filter: { status?: string; conversationId?: string; limit?: number } = {},
  ): Promise<PendingAction[]> {
    let q = this.db.selectFrom("pending_actions").selectAll();
    if (filter.status) q = q.where("status", "=", filter.status);
    if (filter.conversationId) q = q.where("conversation_id", "=", filter.conversationId);
    const rows = await q
      .orderBy("created_at", "desc")
      .limit(filter.limit ?? 100)
      .execute();
    return rows.map(toAction);
  }

  async update(
    id: string,
    patch: { status?: string; result?: unknown; resolvedAt?: string },
  ): Promise<void> {
    await this.db
      .updateTable("pending_actions")
      .set({
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.result !== undefined ? { result: json(patch.result) } : {}),
        ...(patch.resolvedAt ? { resolved_at: patch.resolvedAt } : {}),
      })
      .where("id", "=", id)
      .execute();
  }

  /** Atomically move pending → approved/refused; returns false if someone else got there first. */
  async transition(id: string, from: string, to: string): Promise<boolean> {
    const r = await this.db
      .updateTable("pending_actions")
      .set({ status: to, resolved_at: nowIso() })
      .where("id", "=", id)
      .where("status", "=", from)
      .executeTakeFirst();
    return Number(r.numUpdatedRows) === 1;
  }

  async expireDue(now = nowIso()): Promise<PendingAction[]> {
    const rows = await this.db
      .selectFrom("pending_actions")
      .selectAll()
      .where("status", "=", "pending")
      .where("expires_at", "<", now)
      .execute();
    for (const r of rows) await this.transition(r.id, "pending", "expired");
    return rows.map((r) => ({ ...toAction(r), status: "expired" as const }));
  }

  async listRules(): Promise<ApprovalRule[]> {
    const rows = await this.db
      .selectFrom("approval_rules")
      .selectAll()
      .orderBy("created_at", "desc")
      .execute();
    return rows.map((r) => ({
      id: r.id,
      toolName: r.tool_name,
      service: r.service,
      label: r.label,
      createdAt: r.created_at,
    }));
  }

  async hasRule(toolName: string): Promise<boolean> {
    return !!(await this.db
      .selectFrom("approval_rules")
      .select("id")
      .where("tool_name", "=", toolName)
      .executeTakeFirst());
  }

  async addRule(toolName: string, service: string, label: string): Promise<ApprovalRule> {
    const rule: ApprovalRule = { id: newId("rule"), toolName, service, label, createdAt: nowIso() };
    await this.db
      .insertInto("approval_rules")
      .values({ id: rule.id, tool_name: toolName, service, label, created_at: rule.createdAt })
      .onConflict((oc) => oc.column("tool_name").doNothing())
      .execute();
    return rule;
  }

  async deleteRule(id: string): Promise<void> {
    await this.db.deleteFrom("approval_rules").where("id", "=", id).execute();
  }
}

function toAction(r: PendingActionTable): PendingAction & { toolCallId: string } {
  return {
    id: r.id,
    runId: r.run_id,
    conversationId: r.conversation_id,
    toolName: r.tool_name,
    toolCallId: r.tool_call_id,
    title: r.title,
    summary: r.summary,
    service: r.service,
    recipient: r.recipient,
    amountInr: r.amount_inr,
    details: parse(r.details, []),
    payload: parse(r.payload, null),
    status: r.status as PendingAction["status"],
    tainted: r.tainted === 1,
    involvesMoney: r.involves_money === 1,
    spendCapInr: r.spend_cap_inr,
    idempotencyKey: r.idempotency_key,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    result: parse(r.result, null),
  };
}

/* ───────────── Audit ───────────── */

export class AuditRepo {
  private db: Database;
  private redactor: Redactor;
  private bus: EventBus;
  constructor(db: Database, redactor: Redactor, bus: EventBus) {
    this.db = db;
    this.redactor = redactor;
    this.bus = bus;
  }

  async log(e: {
    kind: AuditEvent["kind"];
    summary: string;
    toolName?: string | null;
    toolClass?: ToolClass | null;
    data?: unknown;
    conversationId?: string | null;
  }): Promise<AuditEvent> {
    const event: AuditEvent = {
      id: newId("aud"),
      ts: nowIso(),
      kind: e.kind,
      toolName: e.toolName ?? null,
      toolClass: e.toolClass ?? null,
      summary: this.redactor.text(e.summary),
      data: this.redactor.value(e.data ?? null),
      conversationId: e.conversationId ?? null,
    };
    await this.db
      .insertInto("audit_events")
      .values({
        id: event.id,
        ts: event.ts,
        kind: event.kind,
        tool_name: event.toolName,
        tool_class: event.toolClass,
        summary: event.summary,
        data: json(event.data),
        conversation_id: event.conversationId,
      })
      .execute();
    this.bus.emit({ type: "audit", event });
    return event;
  }

  async list(
    opts: { limit?: number; before?: string; kind?: string; q?: string } = {},
  ): Promise<AuditEvent[]> {
    let q = this.db.selectFrom("audit_events").selectAll();
    if (opts.before) q = q.where("ts", "<", opts.before);
    if (opts.kind) q = q.where("kind", "like", `${opts.kind}%`);
    if (opts.q)
      q = q.where((eb) =>
        eb.or([eb("summary", "like", `%${opts.q}%`), eb("tool_name", "like", `%${opts.q}%`)]),
      );
    const rows = await q
      .orderBy("ts", "desc")
      .limit(Math.min(opts.limit ?? 100, 500))
      .execute();
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      kind: r.kind as AuditEvent["kind"],
      toolName: r.tool_name,
      toolClass: r.tool_class as ToolClass | null,
      summary: r.summary,
      data: parse(r.data, null),
      conversationId: r.conversation_id,
    }));
  }
}

/* ───────────── Tasks ───────────── */

export class TaskRepo {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  async upsert(t: {
    title: string;
    detail: string;
    status: TaskStatus;
    source: string;
    sourceRef?: string | null;
    conversationId?: string | null;
  }): Promise<Task> {
    const now = nowIso();
    if (t.sourceRef) {
      const existing = await this.db
        .selectFrom("tasks")
        .selectAll()
        .where("source_ref", "=", t.sourceRef)
        .executeTakeFirst();
      if (existing) {
        // Never resurrect a task the user already finished.
        const status = existing.status === "done" ? "done" : t.status;
        await this.db
          .updateTable("tasks")
          .set({ title: t.title, detail: t.detail, status, updated_at: now })
          .where("id", "=", existing.id)
          .execute();
        return (await this.get(existing.id))!;
      }
    }
    const id = newId("task");
    await this.db
      .insertInto("tasks")
      .values({
        id,
        title: t.title,
        detail: t.detail,
        status: t.status,
        source: t.source,
        source_ref: t.sourceRef ?? null,
        conversation_id: t.conversationId ?? null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    return (await this.get(id))!;
  }

  async get(id: string): Promise<Task | null> {
    const r = await this.db.selectFrom("tasks").selectAll().where("id", "=", id).executeTakeFirst();
    return r ? toTask(r) : null;
  }

  async list(status?: TaskStatus): Promise<Task[]> {
    let q = this.db.selectFrom("tasks").selectAll();
    if (status) q = q.where("status", "=", status);
    return (await q.orderBy("updated_at", "desc").limit(300).execute()).map(toTask);
  }

  async setStatus(id: string, status: TaskStatus): Promise<void> {
    await this.db
      .updateTable("tasks")
      .set({ status, updated_at: nowIso() })
      .where("id", "=", id)
      .execute();
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom("tasks").where("id", "=", id).execute();
  }
}

const toTask = (r: {
  id: string;
  title: string;
  detail: string;
  status: string;
  source: string;
  source_ref: string | null;
  conversation_id: string | null;
  created_at: string;
  updated_at: string;
}): Task => ({
  id: r.id,
  title: r.title,
  detail: r.detail,
  status: r.status as TaskStatus,
  source: r.source,
  sourceRef: r.source_ref,
  conversationId: r.conversation_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/* ───────────── Memory ───────────── */

export class MemoryRepo {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  async list(): Promise<MemoryFact[]> {
    const rows = await this.db
      .selectFrom("memory_facts")
      .selectAll()
      .orderBy("category")
      .orderBy("key")
      .execute();
    return rows.map((r) => ({
      id: r.id,
      category: r.category as MemoryFact["category"],
      key: r.key,
      value: r.value,
      source: r.source as MemoryFact["source"],
      updatedAt: r.updated_at,
    }));
  }

  async upsert(f: MemoryFactInput, source: MemoryFact["source"]): Promise<MemoryFact> {
    const now = nowIso();
    const id = newId("mem");
    await this.db
      .insertInto("memory_facts")
      .values({ id, category: f.category, key: f.key, value: f.value, source, updated_at: now })
      .onConflict((oc) =>
        oc.columns(["category", "key"]).doUpdateSet({ value: f.value, source, updated_at: now }),
      )
      .execute();
    const row = await this.db
      .selectFrom("memory_facts")
      .selectAll()
      .where("category", "=", f.category)
      .where("key", "=", f.key)
      .executeTakeFirstOrThrow();
    return {
      id: row.id,
      category: row.category as MemoryFact["category"],
      key: row.key,
      value: row.value,
      source: row.source as MemoryFact["source"],
      updatedAt: row.updated_at,
    };
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom("memory_facts").where("id", "=", id).execute();
  }
}

/* ───────────── Skills ───────────── */

export class SkillRepo {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  async list(): Promise<Skill[]> {
    return (
      await this.db
        .selectFrom("skills")
        .selectAll()
        .orderBy("builtin", "desc")
        .orderBy("slug")
        .execute()
    ).map(toSkill);
  }
  async getBySlug(slug: string): Promise<Skill | null> {
    const r = await this.db
      .selectFrom("skills")
      .selectAll()
      .where("slug", "=", slug)
      .executeTakeFirst();
    return r ? toSkill(r) : null;
  }
  async upsert(s: SkillInput, builtin = false): Promise<Skill> {
    const now = nowIso();
    await this.db
      .insertInto("skills")
      .values({
        id: newId("skill"),
        slug: s.slug,
        title: s.title,
        description: s.description,
        instructions: s.instructions,
        domains: json(s.domains),
        builtin: builtin ? 1 : 0,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.column("slug").doUpdateSet({
          title: s.title,
          description: s.description,
          instructions: s.instructions,
          domains: json(s.domains),
          updated_at: now,
        }),
      )
      .execute();
    return (await this.getBySlug(s.slug))!;
  }
  async seed(s: SkillInput): Promise<void> {
    await this.db
      .insertInto("skills")
      .values({
        id: newId("skill"),
        slug: s.slug,
        title: s.title,
        description: s.description,
        instructions: s.instructions,
        domains: json(s.domains),
        builtin: 1,
        updated_at: nowIso(),
      })
      .onConflict((oc) => oc.column("slug").doNothing())
      .execute();
  }
  async delete(id: string): Promise<void> {
    await this.db.deleteFrom("skills").where("id", "=", id).execute();
  }
}

const toSkill = (r: {
  id: string;
  slug: string;
  title: string;
  description: string;
  instructions: string;
  domains: string;
  builtin: number;
  updated_at: string;
}): Skill => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  description: r.description,
  instructions: r.instructions,
  domains: parse<string[]>(r.domains, []),
  builtin: r.builtin === 1,
  updatedAt: r.updated_at,
});

/* ───────────── Routines ───────────── */

export class RoutineRepo {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  async list(): Promise<Routine[]> {
    return (await this.db.selectFrom("routines").selectAll().orderBy("created_at").execute()).map(
      toRoutine,
    );
  }
  async get(id: string): Promise<Routine | null> {
    const r = await this.db
      .selectFrom("routines")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return r ? toRoutine(r) : null;
  }
  async create(r: RoutineInput, nextRunAt: string | null): Promise<Routine> {
    const id = newId("rtn");
    await this.db
      .insertInto("routines")
      .values({
        id,
        title: r.title,
        prompt: r.prompt,
        cron: r.cron,
        enabled: r.enabled ? 1 : 0,
        next_run_at: nextRunAt,
        last_run_at: null,
        last_status: null,
        created_at: nowIso(),
      })
      .execute();
    return (await this.get(id))!;
  }
  async update(
    id: string,
    patch: Partial<RoutineInput> & {
      nextRunAt?: string | null;
      lastRunAt?: string;
      lastStatus?: "ok" | "error";
    },
  ): Promise<void> {
    await this.db
      .updateTable("routines")
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
        ...(patch.cron !== undefined ? { cron: patch.cron } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled ? 1 : 0 } : {}),
        ...(patch.nextRunAt !== undefined ? { next_run_at: patch.nextRunAt } : {}),
        ...(patch.lastRunAt !== undefined ? { last_run_at: patch.lastRunAt } : {}),
        ...(patch.lastStatus !== undefined ? { last_status: patch.lastStatus } : {}),
      })
      .where("id", "=", id)
      .execute();
  }
  async delete(id: string): Promise<void> {
    await this.db.deleteFrom("routines").where("id", "=", id).execute();
  }
  async startRun(routineId: string): Promise<RoutineRun> {
    const run: RoutineRun = {
      id: newId("rrun"),
      routineId,
      startedAt: nowIso(),
      finishedAt: null,
      status: "running",
      conversationId: null,
      error: null,
    };
    await this.db
      .insertInto("routine_runs")
      .values({
        id: run.id,
        routine_id: routineId,
        started_at: run.startedAt,
        finished_at: null,
        status: "running",
        conversation_id: null,
        error: null,
      })
      .execute();
    return run;
  }
  async finishRun(
    id: string,
    status: "ok" | "error",
    conversationId: string | null,
    error: string | null,
  ): Promise<void> {
    await this.db
      .updateTable("routine_runs")
      .set({ status, finished_at: nowIso(), conversation_id: conversationId, error })
      .where("id", "=", id)
      .execute();
  }
  async listRuns(routineId: string, limit = 20): Promise<RoutineRun[]> {
    const rows = await this.db
      .selectFrom("routine_runs")
      .selectAll()
      .where("routine_id", "=", routineId)
      .orderBy("started_at", "desc")
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      routineId: r.routine_id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      status: r.status as RoutineRun["status"],
      conversationId: r.conversation_id,
      error: r.error,
    }));
  }
}

const toRoutine = (r: {
  id: string;
  title: string;
  prompt: string;
  cron: string;
  enabled: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  created_at: string;
}): Routine => ({
  id: r.id,
  title: r.title,
  prompt: r.prompt,
  cron: r.cron,
  enabled: r.enabled === 1,
  nextRunAt: r.next_run_at,
  lastRunAt: r.last_run_at,
  lastStatus: r.last_status as Routine["lastStatus"],
  createdAt: r.created_at,
});
