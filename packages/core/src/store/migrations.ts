import { sql, type Kysely } from "kysely";
import type { DB } from "./schema.ts";

/** Append-only. Never edit a migration that has shipped; add a new one. */
const MIGRATIONS: { id: number; name: string; up: string }[] = [
  {
    id: 1,
    name: "initial",
    up: `
      CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE secrets (name TEXT PRIMARY KEY, blob TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'chat',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL, parts TEXT NOT NULL, usage TEXT, created_at TEXT NOT NULL);
      CREATE INDEX messages_conv ON messages(conversation_id, created_at);
      CREATE TABLE agent_runs (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        status TEXT NOT NULL, state TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE pending_actions (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
        tool_name TEXT NOT NULL, tool_call_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, service TEXT NOT NULL,
        recipient TEXT, amount_inr REAL, details TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL,
        tainted INTEGER NOT NULL DEFAULT 0, involves_money INTEGER NOT NULL DEFAULT 0, spend_cap_inr REAL,
        idempotency_key TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
        resolved_at TEXT, result TEXT);
      CREATE INDEX pending_actions_status ON pending_actions(status, created_at);
      CREATE TABLE approval_rules (id TEXT PRIMARY KEY, tool_name TEXT NOT NULL UNIQUE, service TEXT NOT NULL,
        label TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL, tool_name TEXT, tool_class TEXT,
        summary TEXT NOT NULL, data TEXT NOT NULL, conversation_id TEXT);
      CREATE INDEX audit_ts ON audit_events(ts);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, detail TEXT NOT NULL, status TEXT NOT NULL,
        source TEXT NOT NULL, source_ref TEXT UNIQUE, conversation_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE mcp_servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, transport TEXT NOT NULL, command TEXT,
        args TEXT NOT NULL DEFAULT '[]', env TEXT NOT NULL DEFAULT '{}', url TEXT, domain TEXT NOT NULL DEFAULT 'general',
        enabled INTEGER NOT NULL DEFAULT 1, builtin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE mcp_tools (server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE, name TEXT NOT NULL,
        description TEXT NOT NULL, tool_class TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, meta TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (server_id, name));
      CREATE TABLE orders (id TEXT PRIMARY KEY, provider TEXT NOT NULL, external_id TEXT NOT NULL, title TEXT NOT NULL,
        amount_inr REAL NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, conversation_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(provider, external_id));
      CREATE TABLE payments (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX payments_order ON payments(order_id);
      CREATE TABLE skills (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL,
        instructions TEXT NOT NULL, domains TEXT NOT NULL DEFAULT '[]', builtin INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE TABLE routines (id TEXT PRIMARY KEY, title TEXT NOT NULL, prompt TEXT NOT NULL, cron TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1, next_run_at TEXT, last_run_at TEXT, last_status TEXT, created_at TEXT NOT NULL);
      CREATE TABLE routine_runs (id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
        started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, conversation_id TEXT, error TEXT);
      CREATE TABLE memory_facts (id TEXT PRIMARY KEY, category TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
        source TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(category, key));
    `,
  },
  {
    id: 2,
    name: "payments_unique_order",
    up: `CREATE UNIQUE INDEX IF NOT EXISTS payments_order_unique ON payments(order_id)`,
  },
];

export async function migrate(db: Kysely<DB>): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`.execute(db);
  const applied = await sql<{ id: number }>`SELECT id FROM _migrations`.execute(db);
  const done = new Set(applied.rows.map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.transaction().execute(async (trx) => {
      for (const stmt of m.up.split(";").map((s) => s.trim()).filter(Boolean)) {
        await sql.raw(stmt).execute(trx);
      }
      await sql`INSERT INTO _migrations (id, name, applied_at) VALUES (${m.id}, ${m.name}, ${new Date().toISOString()})`.execute(trx);
    });
  }
}
