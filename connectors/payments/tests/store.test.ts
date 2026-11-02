import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SqlitePaymentStore } from "../src/store.ts";
import { PaymentService } from "../src/service.ts";

it("persists payments and enforces one payment per order across stores", async () => {
  const dir = mkdtempSync(join(tmpdir(), "india-payment-store-"));
  const first = new SqlitePaymentStore(join(dir, "payments.sqlite"));
  const second = new SqlitePaymentStore(join(dir, "payments.sqlite"));
  try {
    const payment = await new PaymentService({ store: first }).createRequest({ orderId: "fixture-order", amountInr: 12.5, payeeName: "Fixture", payeeVpa: "fixture@bank", note: "test" });
    expect(second.get(payment.id)).toEqual(payment);
    expect(() => second.insert({ ...payment, id: "different" })).toThrow();
    await new PaymentService({ store: second }).userConfirmedUpi(payment.id);
    expect(first.get(payment.id)?.status).toBe("user_confirmed");
  } finally { first.close(); second.close(); rmSync(dir, { recursive: true, force: true }); }
});
