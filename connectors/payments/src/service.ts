import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { MessagePart } from "@relayit/shared";
import { buildUpiUri } from "./upi.ts";
import { upiQrSvg } from "./qr.ts";
import type { RazorpayClient } from "./razorpay.ts";

export type PaymentStatus = "pending" | "paid" | "user_confirmed" | "cancelled" | "expired" | "failed";

export type Payment = {
  id: string;
  orderId: string;
  amountInr: number;
  payeeName: string;
  payeeVpa: string;
  upiUri: string;
  qrSvg: string;
  checkoutUrl: string | null;
  razorpayLinkId: string | null;
  status: PaymentStatus;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  externalRef: string | null;
};

type MaybePromise<T> = T | Promise<T>;
export type PaymentPatch = Partial<Omit<Payment, "id" | "orderId" | "createdAt">>;

export interface PaymentStore {
  /** Implementations must enforce a unique orderId, including across service instances. */
  insert(payment: Payment): MaybePromise<void>;
  get(id: string): MaybePromise<Payment | null>;
  getByOrder(orderId: string): MaybePromise<Payment | null>;
  update(id: string, patch: PaymentPatch): MaybePromise<void>;
}

export class InMemoryPaymentStore implements PaymentStore {
  #payments = new Map<string, Payment>();
  #orders = new Map<string, string>();

  insert(payment: Payment): void {
    if (this.#payments.has(payment.id) || this.#orders.has(payment.orderId)) {
      throw new Error("Payment already exists for this order");
    }
    this.#payments.set(payment.id, structuredClone(payment));
    this.#orders.set(payment.orderId, payment.id);
  }

  get(id: string): Payment | null {
    const payment = this.#payments.get(id);
    return payment ? structuredClone(payment) : null;
  }

  getByOrder(orderId: string): Payment | null {
    const id = this.#orders.get(orderId);
    return id ? this.get(id) : null;
  }

  update(id: string, patch: PaymentPatch): void {
    const payment = this.get(id);
    if (!payment) throw new Error("Payment not found");
    this.#payments.set(id, { ...payment, ...structuredClone(patch) });
  }
}

export type CreatePaymentRequest = {
  orderId: string;
  amountInr: number;
  payeeName: string;
  payeeVpa: string;
  note: string;
  merchantCode?: string;
};

export class PaymentService {
  #store: PaymentStore;
  #razorpay: RazorpayClient | undefined;
  #now: () => Date;
  #locks = new Map<string, Promise<void>>();

  constructor({ store, razorpay, now = () => new Date() }: {
    store: PaymentStore;
    razorpay?: RazorpayClient;
    now?: () => Date;
  }) {
    this.#store = store;
    this.#razorpay = razorpay;
    this.#now = now;
  }

  async getPayment(id: string): Promise<Payment> {
    const payment = await this.#store.get(id);
    if (!payment) throw new Error("Payment not found");
    return payment;
  }

  async getByOrder(orderId: string): Promise<Payment> {
    const payment = await this.#store.getByOrder(orderId);
    if (!payment) throw new Error("Payment not found for order");
    return payment;
  }

  async createRequest(input: CreatePaymentRequest): Promise<Payment> {
    if (!input.orderId.trim()) throw new Error("Order ID is required");
    return this.#withLock(`order:${input.orderId}`, async () => {
      // A settled order is also returned on retry; use a new order ID for a new request.
      const existing = await this.#store.getByOrder(input.orderId);
      if (existing) return existing;
      const id = randomUUID();
      const upiUri = buildUpiUri({
        vpa: input.payeeVpa,
        payeeName: input.payeeName,
        amountInr: input.amountInr,
        note: input.note,
        txnRef: id.replaceAll("-", ""),
        merchantCode: input.merchantCode,
      });
      const qrSvg = await upiQrSvg(upiUri);
      let checkoutUrl: string | null = null;
      let razorpayLinkId: string | null = null;
      if (this.#razorpay) {
        try {
          const link = await this.#razorpay.createPaymentLink({
            amountInr: input.amountInr,
            description: `${input.payeeName}${input.note ? ` · ${input.note}` : ""}`,
            referenceId: id,
          });
          checkoutUrl = link.checkoutUrl;
          razorpayLinkId = link.id;
        } catch {
          // UPI is usable even when the optional test checkout is unavailable.
        }
      }
      const timestamp = this.#now().toISOString();
      const payment: Payment = {
        id,
        orderId: input.orderId,
        amountInr: input.amountInr,
        payeeName: input.payeeName,
        payeeVpa: input.payeeVpa,
        upiUri,
        qrSvg,
        checkoutUrl,
        razorpayLinkId,
        status: "pending",
        createdAt: timestamp,
        updatedAt: timestamp,
        paidAt: null,
        externalRef: null,
      };
      await this.#store.insert(payment);
      return payment;
    });
  }

  async refreshStatus(id: string, options: { signal?: AbortSignal } = {}): Promise<Payment> {
    const payment = await this.getPayment(id);
    if (!this.#razorpay || !payment.razorpayLinkId || !["pending", "user_confirmed"].includes(payment.status)) {
      return payment;
    }
    const link = await this.#razorpay.getPaymentLink(payment.razorpayLinkId, options);
    return this.#withLock(`payment:${id}`, async () => {
      options.signal?.throwIfAborted();
      const current = await this.getPayment(id);
      if (!["pending", "user_confirmed"].includes(current.status)) return current;
      let status: PaymentStatus = current.status;
      if (link.status === "paid") status = "paid";
      else if (current.status === "pending" && ["cancelled", "expired"].includes(link.status)) {
        status = link.status as "cancelled" | "expired";
      }
      if (status === current.status) return current;
      const timestamp = this.#now().toISOString();
      const patch: PaymentPatch = {
        status,
        updatedAt: timestamp,
        paidAt: status === "paid" ? timestamp : current.paidAt,
        externalRef: link.externalRef ?? current.externalRef,
      };
      await this.#store.update(id, patch);
      return { ...current, ...patch };
    });
  }

  async userConfirmedUpi(id: string, utr?: string): Promise<Payment> {
    if (utr !== undefined && !/^\d{12}$/.test(utr)) throw new Error("UTR must be exactly 12 digits");
    return this.#withLock(`payment:${id}`, async () => {
      const payment = await this.getPayment(id);
      if (payment.status === "user_confirmed" || payment.status === "paid") return payment;
      if (payment.status !== "pending") throw new Error(`Cannot confirm a ${payment.status} payment`);
      const timestamp = this.#now().toISOString();
      const patch: PaymentPatch = {
        status: "user_confirmed",
        updatedAt: timestamp,
        // This is the user's assertion time, not independent bank verification.
        paidAt: timestamp,
        externalRef: utr ?? null,
      };
      await this.#store.update(id, patch);
      return { ...payment, ...patch };
    });
  }

  async pollUntilSettled(id: string, { intervalMs = 1_000, timeoutMs = 60_000, signal, onUpdate }: {
    intervalMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    onUpdate?: (payment: Payment) => void | Promise<void>;
  } = {}): Promise<Payment> {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > 2_147_483_647 || !Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647) {
      throw new Error("Invalid polling interval or timeout");
    }
    signal?.throwIfAborted();
    if (timeoutMs === 0) throw new Error("Payment polling timed out");
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      while (true) {
        combined.throwIfAborted();
        const payment = await withAbort(this.refreshStatus(id, { signal: combined }), combined);
        combined.throwIfAborted();
        if (onUpdate) await withAbort(Promise.resolve(onUpdate(payment)), combined);
        combined.throwIfAborted();
        if (payment.status !== "pending") return payment;
        await delay(intervalMs, undefined, { signal: combined });
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (timeout.aborted) throw new Error("Payment polling timed out", { cause: error });
      throw error;
    }
  }

  toMessagePart(payment: Payment): Extract<MessagePart, { type: "payment" }> {
    return toMessagePart(payment);
  }

  async #withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.#locks.set(key, current);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.#locks.get(key) === current) this.#locks.delete(key);
    }
  }
}

async function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export function toMessagePart(payment: Payment): Extract<MessagePart, { type: "payment" }> {
  return {
    type: "payment",
    orderId: payment.orderId,
    upiUri: payment.upiUri,
    qrSvg: payment.qrSvg,
    checkoutUrl: payment.checkoutUrl,
    amountInr: payment.amountInr,
    payee: payment.payeeName,
  };
}
