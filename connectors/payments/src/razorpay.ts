import { z } from "zod";
import { amountInPaise } from "./upi.ts";

export type PaymentLinkStatus = "created" | "partially_paid" | "paid" | "cancelled" | "expired";

const linkSchema = z.object({
  id: z.string().min(1),
  short_url: z.url(),
  amount: z.number().int().positive(),
  currency: z.literal("INR"),
  status: z.enum(["created", "partially_paid", "paid", "cancelled", "expired"]),
  reference_id: z.string().optional(),
  payments: z
    .array(z.object({ payment_id: z.string() }))
    .nullable()
    .optional(),
});

export type PaymentLink = {
  id: string;
  checkoutUrl: string;
  amountInr: number;
  status: PaymentLinkStatus;
  referenceId: string | null;
  externalRef: string | null;
};

export type CreatePaymentLinkInput = {
  amountInr: number;
  description: string;
  referenceId: string;
  customer?: { name: string; email?: string; contact?: string };
  /** Unix timestamp in seconds. */
  expireBy?: number;
};

export class RazorpayClient {
  #keyId: string;
  #keySecret: string;
  #baseUrl: string;

  constructor({
    keyId,
    keySecret,
    baseUrl = "https://api.razorpay.com/v1",
  }: {
    keyId: string;
    keySecret: string;
    baseUrl?: string;
  }) {
    if (!keyId.startsWith("rzp_test_")) {
      throw new Error("RelayIt only supports Razorpay test mode in this version");
    }
    this.#keyId = keyId;
    this.#keySecret = keySecret;
    this.#baseUrl = baseUrl.replace(/\/$/, "");
  }

  async createPaymentLink(input: CreatePaymentLinkInput): Promise<PaymentLink> {
    return this.#request("/payment_links", {
      method: "POST",
      body: JSON.stringify({
        amount: amountInPaise(input.amountInr),
        currency: "INR",
        description: input.description,
        reference_id: input.referenceId,
        customer: input.customer,
        expire_by: input.expireBy,
        reminder_enable: false,
      }),
    });
  }

  async getPaymentLink(id: string, options: { signal?: AbortSignal } = {}): Promise<PaymentLink> {
    return this.#request(`/payment_links/${encodeURIComponent(id)}`, { signal: options.signal });
  }

  async #request(path: string, init: RequestInit): Promise<PaymentLink> {
    const response = await fetch(`${this.#baseUrl}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(15_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${this.#keyId}:${this.#keySecret}`).toString("base64")}`,
      },
    });
    // Do not echo remote bodies: an upstream error can contain sensitive request data.
    if (!response.ok)
      throw new Error(`Razorpay payment-link request failed (HTTP ${response.status})`);
    const result = linkSchema.safeParse(await response.json());
    if (!result.success) throw new Error("Invalid Razorpay payment-link response");
    const data = result.data;
    if (!/^https?:\/\//.test(data.short_url)) throw new Error("Invalid Razorpay checkout URL");
    return {
      id: data.id,
      checkoutUrl: data.short_url,
      amountInr: data.amount / 100,
      status: data.status,
      referenceId: data.reference_id ?? null,
      externalRef: data.payments?.[0]?.payment_id ?? null,
    };
  }
}
