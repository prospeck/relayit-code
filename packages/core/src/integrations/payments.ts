import { z } from "zod";
import {
  PaymentService,
  RazorpayClient,
  createPaymentTools,
  startMockCheckout,
  toMessagePart,
  type Payment,
  type PaymentPatch,
  type PaymentStore,
} from "@relayit/connector-payments";
import type { MessagePart } from "@relayit/shared";
import type { App } from "../app.ts";
import { HttpError } from "../app.ts";
import type { RouteModule } from "../api/server.ts";
import { body } from "../api/server.ts";
import { json, parse } from "../store/db.ts";
import { newId, nowIso } from "../util/ids.ts";
import type { McpManager } from "./mcp.ts";

/** SQLite-backed store for the payments connector. */
class SqlitePaymentStore implements PaymentStore {
  private app: App;
  constructor(app: App) {
    this.app = app;
  }
  async insert(p: Payment) {
    await this.app.db
      .insertInto("payments")
      .values({
        id: p.id,
        order_id: p.orderId,
        data: json(p),
        status: p.status,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
      })
      .execute();
  }
  async get(id: string) {
    const r = await this.app.db
      .selectFrom("payments")
      .select("data")
      .where("id", "=", id)
      .executeTakeFirst();
    return r ? parse<Payment | null>(r.data, null) : null;
  }
  async getByOrder(orderId: string) {
    const r = await this.app.db
      .selectFrom("payments")
      .select("data")
      .where("order_id", "=", orderId)
      .executeTakeFirst();
    return r ? parse<Payment | null>(r.data, null) : null;
  }
  async update(id: string, patch: PaymentPatch) {
    const cur = await this.get(id);
    if (!cur) throw new Error("Payment not found");
    const next = { ...cur, ...patch };
    await this.app.db
      .updateTable("payments")
      .set({ data: json(next), status: next.status, updated_at: nowIso() })
      .where("id", "=", id)
      .execute();
  }
}

type PlacedOrder = {
  orderId: string;
  amountInr: number;
  status?: string;
  etaMin?: number;
  restaurant?: { name?: string } | string;
  payee?: { name: string; vpa: string; merchantCode?: string };
};

/**
 * Payments never move money: RelayIt creates a UPI request (QR + intent link) and, in test mode,
 * a Razorpay checkout link. The user pays in their own app. We only watch the status.
 */
export class PaymentsIntegration {
  private service: PaymentService | null = null;
  private mock: Awaited<ReturnType<typeof startMockCheckout>> | null = null;
  private watching = new Set<string>();

  private app: App;
  private mcp: McpManager;
  constructor(app: App, mcp: McpManager) {
    this.app = app;
    this.mcp = mcp;
  }

  async start() {
    this.app.registry.registerAll(createPaymentTools({ getService: () => this.get() }), "payments");
    this.app.onShutdown(async () => {
      await this.mock?.close();
    });

    // When a food order is placed, attach a payment request and start watching it.
    this.app.hooks.push({
      tools: ["place_order"],
      after: async ({ output, ctx }) => {
        const o = output as PlacedOrder;
        if (!o?.orderId || !o.payee?.vpa || !(o.amountInr > 0)) return;
        const restaurant =
          typeof o.restaurant === "string" ? o.restaurant : (o.restaurant?.name ?? o.payee.name);
        await this.app.db
          .insertInto("orders")
          .values({
            id: newId("ord"),
            provider: "relayit-food",
            external_id: o.orderId,
            title: `Order from ${restaurant}`,
            amount_inr: o.amountInr,
            status: "awaiting_payment",
            data: json(o),
            conversation_id: ctx.conversationId || null,
            created_at: nowIso(),
            updated_at: nowIso(),
          })
          .onConflict((oc) => oc.columns(["provider", "external_id"]).doNothing())
          .execute();
        const svc = await this.get();
        const payment = await svc.createRequest({
          orderId: o.orderId,
          amountInr: o.amountInr,
          payeeName: o.payee.name,
          payeeVpa: o.payee.vpa,
          note: `RelayIt order ${o.orderId}`.slice(0, 80),
          ...(o.payee.merchantCode ? { merchantCode: o.payee.merchantCode } : {}),
        });
        this.watch(payment.id, o.orderId);
        const parts: MessagePart[] = [toMessagePart(payment)];
        return {
          parts,
          output: {
            ...o,
            payment: {
              status: payment.status,
              note: "A UPI QR and payment link are shown to the user. They pay in their own app; you can't pay for them.",
            },
          },
        };
      },
    });

    // Resume watching unpaid payments after a restart.
    const open = await this.app.db
      .selectFrom("payments")
      .select(["id", "order_id"])
      .where("status", "=", "pending")
      .execute();
    for (const p of open) this.watch(p.id, p.order_id);
  }

  async get(): Promise<PaymentService> {
    if (this.service) return this.service;
    const keyId = await this.app.secrets.get("razorpay.keyId");
    const keySecret = await this.app.secrets.get("razorpay.keySecret");
    let razorpay: RazorpayClient | undefined;
    if (keyId && keySecret) razorpay = new RazorpayClient({ keyId, keySecret });
    else {
      this.mock ??= await startMockCheckout({ port: 0 });
      razorpay = new RazorpayClient({
        keyId: "rzp_test_relayitmock",
        keySecret: "mock",
        baseUrl: this.mock.baseUrl,
      });
    }
    this.service = new PaymentService({ store: new SqlitePaymentStore(this.app), razorpay });
    return this.service;
  }

  private watch(paymentId: string, orderId: string) {
    if (this.watching.has(paymentId)) return;
    this.watching.add(paymentId);
    void (async () => {
      try {
        const svc = await this.get();
        const p = await svc.pollUntilSettled(paymentId, {
          intervalMs: 4000,
          timeoutMs: 20 * 60_000,
        });
        await this.settled(p, orderId);
      } catch {
        /* timed out or failed; the user can still confirm manually */
      } finally {
        this.watching.delete(paymentId);
      }
    })();
  }

  async settled(p: Payment, orderId: string) {
    if (p.status !== "paid" && p.status !== "user_confirmed") return;
    await this.mcp
      .callInternal("confirm_order_payment", { orderId, paymentRef: p.externalRef ?? p.id })
      .catch(() => {});
    await this.app.db
      .updateTable("orders")
      .set({ status: "confirmed", updated_at: nowIso() })
      .where("external_id", "=", orderId)
      .execute();
    await this.app.audit.log({
      kind: "action.executed",
      summary: `Payment ${p.status === "paid" ? "received" : "marked as paid"} — order ${orderId} confirmed`,
      data: { orderId, amountInr: p.amountInr },
    });
    this.app.bus.emit({
      type: "notify",
      kind: "order",
      title: "Order confirmed",
      body: `₹${p.amountInr} paid. It's being prepared.`,
    });
    this.app.bus.emit({ type: "tasks.updated" });
  }

  routes(): RouteModule {
    return (api) => {
      api.get("/api/payments/by-order/:orderId", async (c) => {
        const svc = await this.get();
        let p = await svc.getByOrder(c.req.param("orderId")).catch(() => null);
        if (!p) throw new HttpError(404, "No payment for that order");
        if (p.status === "pending") p = await svc.refreshStatus(p.id).catch(() => p!);
        if (p.status === "paid") await this.settled(p, p.orderId);
        return c.json({ status: p.status, paidAt: p.paidAt ?? null });
      });
      api.post("/api/payments/by-order/:orderId/user-confirmed", async (c) => {
        const { utr } = await body(
          c,
          z.object({
            utr: z
              .string()
              .regex(/^\d{12}$/)
              .optional(),
          }),
        );
        const svc = await this.get();
        const p = await svc.getByOrder(c.req.param("orderId")).catch(() => null);
        if (!p) throw new HttpError(404, "No payment for that order");
        const updated = await svc.userConfirmedUpi(p.id, utr);
        await this.settled(updated, updated.orderId);
        return c.json({ status: updated.status });
      });
      api.put("/api/payments/razorpay", async (c) => {
        const k = await body(
          c,
          z.object({
            keyId: z.string().startsWith("rzp_test_", "Only Razorpay test keys are supported"),
            keySecret: z.string().min(8),
          }),
        );
        await this.app.secrets.set("razorpay.keyId", k.keyId);
        await this.app.secrets.set("razorpay.keySecret", k.keySecret);
        this.service = null;
        await this.app.audit.log({ kind: "secret.saved", summary: "Razorpay test keys saved" });
        return c.json({ ok: true });
      });
    };
  }
}
