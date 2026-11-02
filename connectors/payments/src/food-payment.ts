import { MockFoodProvider } from "../../food/src/mock/provider.ts";
import type { Payment } from "./service.ts";

export async function confirmPaidDemoOrder(foodDir: string, payment: Payment): Promise<void> {
  if (payment.status !== "paid" || !payment.externalRef) return;
  const provider = new MockFoodProvider(foodDir);
  let order;
  try { order = await provider.getOrder(payment.orderId); } catch { return; }
  if (order.amountInr !== payment.amountInr || order.payee.vpa !== payment.payeeVpa || order.payee.name !== payment.payeeName) {
    throw new Error("Payment does not match the quoted demo order");
  }
  await provider.confirmPayment(order.orderId, payment.externalRef);
}
