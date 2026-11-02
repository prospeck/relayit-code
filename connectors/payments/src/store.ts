import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Payment, PaymentPatch, PaymentStore } from "./service.ts";

export class SqlitePaymentStore implements PaymentStore {
  private readonly db: DatabaseSync;
  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, order_id TEXT UNIQUE NOT NULL, data TEXT NOT NULL)");
  }
  insert(payment: Payment) {
    this.db.prepare("INSERT INTO payments VALUES (?, ?, ?)").run(payment.id, payment.orderId, JSON.stringify(payment));
  }
  get(id: string): Payment | null {
    const row = this.db.prepare("SELECT data FROM payments WHERE id = ?").get(id);
    return row ? JSON.parse(row.data as string) as Payment : null;
  }
  getByOrder(orderId: string): Payment | null {
    const row = this.db.prepare("SELECT data FROM payments WHERE order_id = ?").get(orderId);
    return row ? JSON.parse(row.data as string) as Payment : null;
  }
  update(id: string, patch: PaymentPatch) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(id);
      if (!current) throw new Error("Payment not found");
      this.db.prepare("UPDATE payments SET data = ? WHERE id = ?").run(JSON.stringify({ ...current, ...patch }), id);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  close() { this.db.close(); }
}
