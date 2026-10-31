import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MessagePart } from "@relayit/shared";
import { InMemoryPaymentStore, PaymentService, toMessagePart } from "../src/service.ts";
import { RazorpayClient } from "../src/razorpay.ts";
import { startMockCheckout } from "../src/mockCheckout.ts";

let mock: Awaited<ReturnType<typeof startMockCheckout>>;
beforeAll(async () => { mock = await startMockCheckout(); });
afterAll(async () => { await mock?.close(); });
afterEach(() => { vi.restoreAllMocks(); });

const input = { orderId: "order-1", amountInr: 249.5, payeeName: "Asha’s store", payeeVpa: "asha@bank", note: "Lunch" };

function setup(withCheckout = false) {
  const store = new InMemoryPaymentStore();
  const razorpay = withCheckout ? new RazorpayClient({ keyId: "rzp_test_local", keySecret: "unused-local-placeholder", baseUrl: mock.baseUrl }) : undefined;
  const service = new PaymentService({ store, razorpay, now: () => new Date("2026-11-01T12:00:00Z") });
  return { store, razorpay, service };
}

describe("PaymentService", () => {
  it("is idempotent per order even for concurrent requests and creates a valid shared part", async () => {
    const { service } = setup(true);
    const payments = await Promise.all(Array.from({ length: 5 }, () => service.createRequest(input)));
    expect(new Set(payments.map((payment) => payment.id)).size).toBe(1);
    const payment = payments[0]!;
    expect(await service.createRequest({ ...input, amountInr: 999 })).toEqual(payment);
    expect(payment).toMatchObject({ status: "pending", createdAt: "2026-11-01T12:00:00.000Z", paidAt: null, externalRef: null });
    expect(payment.checkoutUrl).toContain("/pay/plink_");
    expect(MessagePart.parse(toMessagePart(payment))).toMatchObject({ type: "payment", orderId: "order-1", payee: "Asha’s store" });
    expect(service.toMessagePart(payment)).toEqual(toMessagePart(payment));
  });

  it("uses UPI alone when no Razorpay client is configured", async () => {
    const { service } = setup();
    const payment = await service.createRequest(input);
    expect(payment.checkoutUrl).toBeNull();
    expect(payment.razorpayLinkId).toBeNull();
    expect(payment.upiUri).toContain("upi://pay?");
    expect(payment.qrSvg).toContain("<svg");
    expect(await service.refreshStatus(payment.id)).toEqual(payment);
  });

  it("falls back to UPI when Razorpay link creation fails", async () => {
    const { service, razorpay } = setup(true);
    vi.spyOn(razorpay!, "createPaymentLink").mockRejectedValue(new Error("Checkout unavailable"));
    const payment = await service.createRequest(input);
    expect(payment).toMatchObject({ status: "pending", checkoutUrl: null, razorpayLinkId: null });
    expect(payment.upiUri).toContain("upi://pay?");
    expect(payment.qrSvg).toContain("<svg");
  });

  it("records a Razorpay-confirmed payment and does not create another request on retry", async () => {
    const { service } = setup(true);
    const payment = await service.createRequest(input);
    await fetch(`${payment.checkoutUrl}/complete`, { method: "POST" });
    const paid = await service.refreshStatus(payment.id);
    expect(paid).toMatchObject({ status: "paid", paidAt: "2026-11-01T12:00:00.000Z" });
    expect(paid.externalRef).toMatch(/^pay_mock_/);
    expect(await service.createRequest(input)).toEqual(paid);
    expect(await service.userConfirmedUpi(payment.id, "123456789012")).toEqual(paid);
  });

  it.each(["cancelled", "expired"] as const)("maps %s checkout status", async (status) => {
    const { service, razorpay } = setup(true);
    const payment = await service.createRequest(input);
    const link = await razorpay!.getPaymentLink(payment.razorpayLinkId!);
    vi.spyOn(razorpay!, "getPaymentLink").mockResolvedValue({ ...link, status });
    expect((await service.refreshStatus(payment.id)).status).toBe(status);
    await expect(service.userConfirmedUpi(payment.id)).rejects.toThrow(`Cannot confirm a ${status} payment`);
  });

  it("keeps partially-paid checkout requests pending", async () => {
    const { service, razorpay } = setup(true);
    const payment = await service.createRequest(input);
    const link = await razorpay!.getPaymentLink(payment.razorpayLinkId!);
    vi.spyOn(razorpay!, "getPaymentLink").mockResolvedValue({ ...link, status: "partially_paid" });
    expect((await service.refreshStatus(payment.id)).status).toBe("pending");
  });

  it("records a user assertion and UTR idempotently without claiming independent verification", async () => {
    const { service } = setup();
    const payment = await service.createRequest(input);
    const confirmed = await service.userConfirmedUpi(payment.id, "123456789012");
    expect(confirmed).toMatchObject({ status: "user_confirmed", externalRef: "123456789012", paidAt: "2026-11-01T12:00:00.000Z" });
    expect(await service.userConfirmedUpi(payment.id, "123456789012")).toEqual(confirmed);
    expect(await service.userConfirmedUpi(payment.id, "999999999999")).toEqual(confirmed);
  });

  it("supports user confirmation without a UTR", async () => {
    const { service } = setup();
    const payment = await service.createRequest(input);
    expect(await service.userConfirmedUpi(payment.id)).toMatchObject({ status: "user_confirmed", externalRef: null });
  });

  it.each(["", "123", "1234567890123", "12345678901a", " 123456789012", "１２３４５６７８９０１２"])("rejects invalid UTR %j", async (utr) => {
    const { service } = setup();
    const payment = await service.createRequest(input);
    await expect(service.userConfirmedUpi(payment.id, utr)).rejects.toThrow("12 digits");
    expect((await service.getPayment(payment.id)).status).toBe("pending");
  });

  it("preserves a UPI user confirmation if the optional checkout is cancelled", async () => {
    const { service } = setup(true);
    const payment = await service.createRequest(input);
    await service.userConfirmedUpi(payment.id, "123456789012");
    await fetch(`${payment.checkoutUrl}/cancel`, { method: "POST" });
    expect((await service.refreshStatus(payment.id)).status).toBe("user_confirmed");
  });

  it("can upgrade a user assertion to a Razorpay-confirmed payment", async () => {
    const { service } = setup(true);
    const payment = await service.createRequest(input);
    await service.userConfirmedUpi(payment.id);
    await fetch(`${payment.checkoutUrl}/complete`, { method: "POST" });
    expect((await service.refreshStatus(payment.id)).status).toBe("paid");
  });

  it("finds payments by order and reports missing payments", async () => {
    const { service } = setup();
    const payment = await service.createRequest(input);
    expect(await service.getByOrder(input.orderId)).toEqual(payment);
    await expect(service.getPayment("missing")).rejects.toThrow("not found");
    await expect(service.getByOrder("missing")).rejects.toThrow("not found");
  });

  it("does not expose stored records to accidental caller mutation", async () => {
    const { store, service } = setup();
    const payment = await service.createRequest(input);
    payment.status = "paid";
    expect(store.get(payment.id)?.status).toBe("pending");
    const loaded = store.get(payment.id)!;
    loaded.payeeName = "Changed";
    expect(store.get(payment.id)?.payeeName).toBe(input.payeeName);
    expect(() => store.insert(loaded)).toThrow("already exists");
    expect(() => store.update("missing", {})).toThrow("not found");
  });
});

describe("pollUntilSettled", () => {
  it("reports updates and resolves after the test checkout is paid", async () => {
    const { service } = setup(true);
    const payment = await service.createRequest(input);
    const statuses: string[] = [];
    const settled = await service.pollUntilSettled(payment.id, {
      intervalMs: 5, timeoutMs: 2000,
      async onUpdate(update) {
        statuses.push(update.status);
        if (update.status === "pending") await fetch(`${payment.checkoutUrl}/complete`, { method: "POST" });
      },
    });
    expect(settled.status).toBe("paid");
    expect(statuses).toEqual(["pending", "paid"]);
  });

  it("times out even when the injected wall clock stays fixed", async () => {
    const { service } = setup();
    const payment = await service.createRequest(input);
    await expect(service.pollUntilSettled(payment.id, { intervalMs: 5, timeoutMs: 25 })).rejects.toThrow("timed out");
  });

  it("aborts an in-flight status request at its timeout", async () => {
    const { service, razorpay } = setup(true);
    const payment = await service.createRequest(input);
    vi.spyOn(razorpay!, "getPaymentLink").mockImplementation((_id, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
    }));
    await expect(service.pollUntilSettled(payment.id, { intervalMs: 5, timeoutMs: 25 })).rejects.toThrow("timed out");
  });

  it("respects caller cancellation during a wait", async () => {
    const { service } = setup();
    const payment = await service.createRequest(input);
    const controller = new AbortController();
    await expect(service.pollUntilSettled(payment.id, {
      intervalMs: 1000, timeoutMs: 2000, signal: controller.signal,
      onUpdate() { controller.abort(new Error("User stopped polling")); },
    })).rejects.toThrow("User stopped polling");
  });

  it("respects the timeout while an update callback is still pending", async () => {
    const { service } = setup();
    const payment = await service.createRequest(input);
    await expect(service.pollUntilSettled(payment.id, {
      intervalMs: 5, timeoutMs: 25, onUpdate: () => new Promise<void>(() => {}),
    })).rejects.toThrow("timed out");
  });

  it("does not poll when already aborted", async () => {
    const { service } = setup();
    const controller = new AbortController();
    controller.abort(new Error("Stopped"));
    await expect(service.pollUntilSettled("missing", { signal: controller.signal })).rejects.toThrow("Stopped");
  });

  it("settles after a user confirmation", async () => {
    const { service } = setup();
    const payment = await service.createRequest(input);
    await service.userConfirmedUpi(payment.id);
    expect((await service.pollUntilSettled(payment.id)).status).toBe("user_confirmed");
  });

  it("rejects invalid intervals and immediate timeouts", async () => {
    const { service } = setup();
    await expect(service.pollUntilSettled("missing", { intervalMs: 0 })).rejects.toThrow("Invalid polling");
    await expect(service.pollUntilSettled("missing", { timeoutMs: -1 })).rejects.toThrow("Invalid polling");
    await expect(service.pollUntilSettled("missing", { timeoutMs: 0 })).rejects.toThrow("timed out");
  });
});
