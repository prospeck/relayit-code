import { defineTool, formatInr } from "@relayit/shared";
import type { MessagePart, ToolContext, ToolDef } from "@relayit/shared";
import { z } from "zod";
import { PaymentService, toMessagePart } from "./service.ts";
import type { Payment } from "./service.ts";
import { amountInPaise, VPA_PATTERN } from "./upi.ts";

type PaymentOutput = Pick<
  Payment,
  | "id"
  | "orderId"
  | "amountInr"
  | "payeeName"
  | "payeeVpa"
  | "status"
  | "upiUri"
  | "checkoutUrl"
  | "externalRef"
>;

export function createPaymentTools({
  getService,
}: {
  getService: (ctx: ToolContext) => Promise<PaymentService>;
}): ToolDef[] {
  const createInput = z.object({
    orderId: z.string().trim().min(1),
    amountInr: z
      .number()
      .positive()
      .max(100_000)
      .refine((amount) => {
        try {
          amountInPaise(amount);
          return true;
        } catch {
          return false;
        }
      }, "Amount must have at most two decimal places"),
    payeeName: z.string().trim().min(1),
    payeeVpa: z.string().regex(VPA_PATTERN),
    note: z
      .string()
      .refine((note) => Array.from(note).length <= 80, "Note must be at most 80 characters"),
  });
  const lookupInput = z
    .object({
      paymentId: z.string().min(1).optional(),
      orderId: z.string().min(1).optional(),
    })
    .refine(
      (input) => Boolean(input.paymentId) !== Boolean(input.orderId),
      "Provide paymentId or orderId",
    );
  const confirmInput = z.object({
    paymentId: z.string().min(1),
    utr: z
      .string()
      .regex(/^\d{12}$/, "UTR must be exactly 12 digits")
      .optional(),
  });

  // UI-only data stays out of enumerable tool output and JSON sent to the model.
  const parts = new WeakMap<PaymentOutput, MessagePart>();
  function output(payment: Payment): PaymentOutput {
    const result: PaymentOutput = {
      id: payment.id,
      orderId: payment.orderId,
      amountInr: payment.amountInr,
      payeeName: payment.payeeName,
      payeeVpa: payment.payeeVpa,
      status: payment.status,
      upiUri: payment.upiUri,
      checkoutUrl: payment.checkoutUrl,
      externalRef: payment.externalRef,
    };
    parts.set(result, toMessagePart(payment));
    return result;
  }

  return [
    defineTool({
      name: "payments_create_request",
      description:
        "Prepare a UPI QR and optional Razorpay test checkout. The user pays in their own app; RelayIt never moves money.",
      domain: "payments",
      toolClass: "prepare",
      service: "UPI",
      involvesMoney: false,
      input: createInput,
      label: () => "Preparing payment request",
      async run(input, ctx) {
        return output(await (await getService(ctx)).createRequest(input));
      },
      toParts(result) {
        const part = parts.get(result);
        return part ? [part] : [];
      },
    }),
    defineTool({
      name: "payments_check_status",
      description:
        "Check a payment by paymentId or orderId. UPI user confirmations are not independently verified.",
      domain: "payments",
      toolClass: "read",
      service: "UPI",
      input: lookupInput,
      async run(input, ctx) {
        const service = await getService(ctx);
        const payment = input.paymentId
          ? await service.getPayment(input.paymentId)
          : await service.getByOrder(input.orderId!);
        return output(await service.refreshStatus(payment.id, { signal: ctx.signal }));
      },
    }),
    defineTool({
      name: "payments_mark_paid_by_user",
      description:
        "Record the user's assertion that they paid via UPI, with an optional 12-digit UTR. This does not move money or verify a bank payment.",
      domain: "payments",
      toolClass: "act",
      service: "UPI",
      involvesMoney: false,
      input: confirmInput,
      async preview(input, ctx) {
        const payment = await (await getService(ctx)).getPayment(input.paymentId);
        return {
          title: `Mark ${formatInr(payment.amountInr)} as paid`,
          summary:
            "Record your confirmation of a UPI payment. This does not verify the payment with your bank.",
          service: "UPI",
          recipient: payment.payeeName,
          amountInr: payment.amountInr,
          details: [
            { label: "Payee", value: payment.payeeName },
            { label: "UPI ID", value: payment.payeeVpa },
            { label: "UTR", value: input.utr ?? "Not provided" },
          ],
        };
      },
      async run(input, ctx) {
        return output(await (await getService(ctx)).userConfirmedUpi(input.paymentId, input.utr));
      },
    }),
  ];
}
