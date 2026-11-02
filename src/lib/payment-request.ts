import { z } from "zod";
import { buildUpiUri, parseUpiUri } from "../../connectors/payments/src/upi";

const card = z.object({
  type: z.literal("payment"), id: z.string().min(1), orderId: z.string().min(1),
  amountInr: z.number().positive().max(100_000), payeeName: z.string().min(1), payeeVpa: z.string().min(1),
  status: z.enum(["pending", "paid", "user_confirmed", "cancelled", "expired", "failed"]),
  upiUri: z.string().max(4_096), checkoutUrl: z.string().nullable(), demo: z.boolean().optional(),
});
export type PaymentRequest = z.infer<typeof card>;

export function paymentRequest(name: string, output: string | undefined): PaymentRequest | null {
  if (!/^mcp__india-payments__payments_(?:create_request|check_status|mark_paid_by_user)$/.test(name) || !output || output.length > 64_000) return null;
  function parse(value: unknown, depth = 0): PaymentRequest | null {
    if (depth > 4) return null;
    if (typeof value === "string") {
      try { return parse(JSON.parse(value), depth + 1); } catch { return null; }
    }
    const parsed = card.safeParse(value);
    if (parsed.success) {
      const payment = parsed.data;
      try {
        const upi = parseUpiUri(payment.upiUri);
        if (buildUpiUri(upi) !== payment.upiUri) return null;
        if (upi.amountInr !== payment.amountInr || upi.vpa !== payment.payeeVpa || upi.payeeName !== payment.payeeName) return null;
        if (payment.checkoutUrl) {
          const url = new URL(payment.checkoutUrl);
          const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
          const razorpay = url.hostname === "rzp.io" || url.hostname === "razorpay.com" || url.hostname.endsWith(".razorpay.com");
          if (url.username || url.password || !(url.protocol === "https:" && razorpay || url.protocol === "http:" && loopback)) return null;
        }
        return payment;
      } catch { return null; }
    }
    if (value && typeof value === "object" && "content" in value && Array.isArray(value.content)) {
      for (const part of value.content) {
        if (part?.type === "text") { const result = parse(part.text, depth + 1); if (result) return result; }
      }
    }
    return null;
  }
  return parse(output);
}
