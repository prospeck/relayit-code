import { z } from "zod";

/** The payment card is display data. Only the person's own payment app can send money. */
export const PaymentPart = z.object({
  type: z.literal("payment"),
  orderId: z.string().min(1),
  upiUri: z.string().startsWith("upi://pay?"),
  qrSvg: z.string(),
  checkoutUrl: z.string().nullable(),
  amountInr: z.number().positive().max(100_000),
  payee: z.string().min(1),
});
export type PaymentPart = z.infer<typeof PaymentPart>;
