import { describe, expect, it } from "vitest";
import { MessagePart } from "@relayit/shared";
import type { ToolContext } from "@relayit/shared";
import { createPaymentTools } from "../src/tools.ts";
import { InMemoryPaymentStore, PaymentService } from "../src/service.ts";

function setup() {
  const service = new PaymentService({ store: new InMemoryPaymentStore() });
  const tools = createPaymentTools({ getService: async () => service });
  const ctx: ToolContext = {
    conversationId: "conversation", runId: "run", signal: new AbortController().signal,
    idempotencyKey: "confirmation-retry", profile: null, memory: [],
    secrets: { async get() { return null; }, async set() {}, async delete() {} },
    kv: { async get() { return null; }, async set() {} },
    status() {},
  };
  return { service, ctx, create: tools[0]!, check: tools[1]!, confirm: tools[2]! };
}

const input = { orderId: "order-tools", amountInr: 450, payeeName: "Asha", payeeVpa: "asha@bank", note: "Groceries" };

describe("payment tools", () => {
  it("prepares a request, returns a payment part and excludes QR data from model output", async () => {
    const { create, ctx } = setup();
    expect(create).toMatchObject({ name: "payments_create_request", toolClass: "prepare", involvesMoney: false, domain: "payments", service: "UPI" });
    const validated = create.input.parse(input);
    const result = await create.run(validated, ctx);
    expect(result).not.toHaveProperty("qrSvg");
    expect(JSON.stringify(result)).not.toContain("qrSvg");
    expect(JSON.stringify(result)).not.toContain("<svg");
    const parts = create.toParts!(result, validated);
    expect(parts).toHaveLength(1);
    expect(MessagePart.parse(parts[0])).toMatchObject({ type: "payment", orderId: input.orderId, amountInr: 450, payee: "Asha", checkoutUrl: null });
    expect(parts[0]?.type === "payment" && parts[0].qrSvg).toContain("<svg");
    const repeated = await create.run(validated, ctx);
    expect(repeated.id).toBe(result.id);
  });

  it("checks status by payment or order ID with compact output", async () => {
    const { create, check, ctx } = setup();
    const created = await create.run(input, ctx);
    expect(check.toolClass).toBe("read");
    expect(await check.run(check.input.parse({ paymentId: created.id }), ctx)).toMatchObject({ id: created.id, status: "pending" });
    const result = await check.run(check.input.parse({ orderId: input.orderId }), ctx);
    expect(result.id).toBe(created.id);
    expect(result).not.toHaveProperty("qrSvg");
    expect(() => check.input.parse({})).toThrow();
    expect(() => check.input.parse({ paymentId: created.id, orderId: input.orderId })).toThrow();
  });

  it("previews the stored amount, payee, UPI ID and UTR without changing the payment", async () => {
    const { create, confirm, ctx, service } = setup();
    const created = await create.run(input, ctx);
    const validated = confirm.input.parse({ paymentId: created.id, utr: "123456789012" });
    expect(confirm).toMatchObject({ name: "payments_mark_paid_by_user", toolClass: "act", domain: "payments", service: "UPI" });
    expect(await confirm.preview!(validated, ctx)).toMatchObject({
      title: "Mark ₹450 as paid", amountInr: 450,
      details: [{ label: "Payee", value: "Asha" }, { label: "UPI ID", value: "asha@bank" }, { label: "UTR", value: "123456789012" }],
    });
    expect((await service.getPayment(created.id)).status).toBe("pending");
    const result = await confirm.run(validated, ctx);
    expect(result).toMatchObject({ status: "user_confirmed", externalRef: "123456789012" });
    expect(result).not.toHaveProperty("qrSvg");
    expect(await confirm.run(validated, ctx)).toEqual(result);
  });

  it("validates create input and UTR before execution", () => {
    const { create, confirm } = setup();
    expect(() => create.input.parse({ ...input, amountInr: 0 })).toThrow();
    expect(() => create.input.parse({ ...input, payeeVpa: "invalid" })).toThrow();
    expect(() => create.input.parse({ ...input, note: "a".repeat(81) })).toThrow();
    expect(() => confirm.input.parse({ paymentId: "some-id", utr: "abc" })).toThrow();
  });
});
