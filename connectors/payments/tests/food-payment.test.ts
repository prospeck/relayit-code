import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { MockFoodProvider } from "../../food/src/mock/provider.ts";
import { confirmPaidDemoOrder } from "../src/food-payment.ts";
import { InMemoryPaymentStore, PaymentService } from "../src/service.ts";

it("confirms only a settled payment matching the stored demo order", async () => {
  const dir = mkdtempSync(join(tmpdir(), "india-reconcile-"));
  try {
    const food = new MockFoodProvider(dir);
    const cart = await food.quote({ restaurantId: "california-pizza-kitchen", items: [{ itemId: "california-pizza-kitchen-1", qty: 1 }], deliveryAddress: { label: "Demo", line: "12 Demo Road" } });
    const order = await food.placeOrder(cart.cartId);
    const request = await new PaymentService({ store: new InMemoryPaymentStore() }).createRequest({ orderId: order.orderId, amountInr: order.amountInr, payeeName: order.payee.name, payeeVpa: order.payee.vpa, note: "demo" });
    await confirmPaidDemoOrder(dir, { ...request, status: "user_confirmed", externalRef: "assertion" });
    expect((await food.getOrder(order.orderId)).status).toBe("awaiting_payment");
    await expect(confirmPaidDemoOrder(dir, { ...request, status: "paid", amountInr: 1, externalRef: "mock-paid" })).rejects.toThrow("does not match");
    expect((await food.getOrder(order.orderId)).status).toBe("awaiting_payment");
    await confirmPaidDemoOrder(dir, { ...request, status: "paid", externalRef: "mock-paid" });
    expect((await food.getOrder(order.orderId)).status).toBe("confirmed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
