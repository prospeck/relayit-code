import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { amountInPaise, VPA_PATTERN } from "./upi.ts";
import type { Payment, PaymentService } from "./service.ts";

export const createInput = z.object({
  orderId: z.string().trim().min(1),
  amountInr: z.number().positive().max(100_000).refine((amount) => {
    try { amountInPaise(amount); return true; } catch { return false; }
  }, "Amount must have at most two decimal places"),
  payeeName: z.string().trim().min(1),
  payeeVpa: z.string().regex(VPA_PATTERN),
  note: z.string().refine((note) => Array.from(note).length <= 80, "Note must be at most 80 characters"),
});
export const lookupInput = z.object({
  paymentId: z.string().min(1).optional(),
  orderId: z.string().min(1).optional(),
}).refine((input) => Boolean(input.paymentId) !== Boolean(input.orderId), "Provide paymentId or orderId");
export const confirmInput = z.object({
  paymentId: z.string().min(1),
  utr: z.string().regex(/^\d{12}$/, "UTR must be exactly 12 digits").optional(),
});

export function paymentOutput(payment: Payment) {
  const { id, orderId, amountInr, payeeName, payeeVpa, status, upiUri, checkoutUrl, externalRef } = payment;
  return { type: "payment" as const, demo: payeeName.endsWith(" (demo)"), id, orderId, amountInr, payeeName, payeeVpa, status, upiUri, checkoutUrl, externalRef };
}

export function registerTools(server: McpServer, service: PaymentService, settled?: (payment: Payment) => Promise<void>) {
  async function result(work: () => Promise<Payment>) {
    try {
      const payment = await work();
      if (payment.status === "paid") await settled?.(payment);
      return { content: [{ type: "text" as const, text: JSON.stringify(paymentOutput(payment)) }] };
    } catch {
      return { isError: true, content: [{ type: "text" as const, text: "Payment request failed. Check the request or connection and retry." }] };
    }
  }
  server.registerTool("payments_create_request", {
    description: "Prepare a UPI QR and optional Razorpay test link for a quoted order. Never sends money; the person pays themselves. Use the exact quoted payee and amount. Demo orders must never be paid with real money.",
    inputSchema: createInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, (input) => result(() => service.createRequest(input)));
  server.registerTool("payments_check_status", {
    description: "Check payment by paymentId or orderId. A user_confirmed UPI assertion is not bank verification. Razorpay is test mode only.",
    inputSchema: lookupInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, (input) => result(async () => {
    const payment = input.paymentId ? await service.getPayment(input.paymentId) : await service.getByOrder(input.orderId!);
    return service.refreshStatus(payment.id);
  }));
  server.registerTool("payments_mark_paid_by_user", {
    description: "Requires the person's approval: record their assertion that they paid, optionally with a 12-digit UTR. Does not verify payment or confirm an order.",
    inputSchema: confirmInput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, (input) => result(() => service.userConfirmedUpi(input.paymentId, input.utr)));
}
