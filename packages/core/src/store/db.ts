import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Kysely, SqliteDialect, type SqliteDatabase, type SqliteStatement } from "kysely";
import type { DB } from "./schema.ts";
import { migrate } from "./migrations.ts";

/** Adapts node:sqlite's DatabaseSync to the better-sqlite3-like shape Kysely's SqliteDialect expects. */
function adapt(db: DatabaseSync): SqliteDatabase {
  const bind = (params: ReadonlyArray<unknown>) =>
    params.map((p) =>
      typeof p === "boolean" ? (p ? 1 : 0) : p === undefined ? null : p,
    ) as never[];
  return {
    close: () => db.close(),
    prepare(sql: string): SqliteStatement {
      const stmt = db.prepare(sql);
      return {
        reader: stmt.columns().length > 0,
        all: (params) => stmt.all(...bind(params)),
        run: (params) => {
          const r = stmt.run(...bind(params));
          return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
        },
        iterate: (params) => stmt.iterate(...bind(params)) as IterableIterator<unknown>,
      };
    },
  };
}

export type Database = Kysely<DB>;

export async function openDatabase(path: string): Promise<Database> {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: adapt(raw) }) });
  await migrate(db);
  return db;
}

export const json = <T>(value: T): string => JSON.stringify(value ?? null);
export const parse = <T>(text: string | null | undefined, fallback: T): T => {
  if (text == null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};
