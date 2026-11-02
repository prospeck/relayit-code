import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer as foodServer } from "../connectors/food/src/server.ts";
import { MockFoodProvider } from "../connectors/food/src/mock/provider.ts";
import { createServer as travelServer } from "../connectors/travel/src/server.ts";
import { createServer as paymentServer } from "../connectors/payments/src/server.ts";
import { PaymentService } from "../connectors/payments/src/service.ts";
import { SqlitePaymentStore } from "../connectors/payments/src/store.ts";
import { RazorpayClient } from "../connectors/payments/src/razorpay.ts";
import { startMockCheckout } from "../connectors/payments/src/mockCheckout.ts";
import { confirmPaidDemoOrder } from "../connectors/payments/src/food-payment.ts";
import { LoginStore } from "./login-store.ts";

export async function runIndiaConnector(kind: string, dataDir: string, credentialId?: string) {
  const foodDir = join(dataDir, "india-services", "food");
  if (kind === "food") return foodServer(new MockFoodProvider(foodDir)).connect(new StdioServerTransport());
  if (kind === "travel") return travelServer().connect(new StdioServerTransport());
  if (kind !== "payments") throw new Error("Unknown India connector");
  let razorpay: RazorpayClient | undefined;
  if (credentialId) {
    const credential = new LoginStore({ dataDir }).get(credentialId);
    if (!credential || credential.site !== "api.razorpay.com") throw new Error("Payment credential unavailable");
    const keys = JSON.parse(credential.password) as { keyId: string; keySecret: string };
    razorpay = new RazorpayClient(keys);
  }
  if (!razorpay) {
    const baseUrl = process.env.RELAYIT_MOCK_CHECKOUT_BASE_URL ?? (await startMockCheckout()).baseUrl;
    if (!/^http:\/\/127\.0\.0\.1:\d+(?:\/api\/india\/mock-checkout)?\/v1$/.test(baseUrl)) throw new Error("Mock checkout must be local");
    razorpay = new RazorpayClient({ keyId: "rzp_test_local", keySecret: "unused-local-placeholder", baseUrl });
  }
  const service = new PaymentService({ store: new SqlitePaymentStore(join(dataDir, "india-services", "payments.sqlite")), razorpay });
  return paymentServer(service, (payment) => confirmPaidDemoOrder(foodDir, payment), async (input) => {
    const order = await new MockFoodProvider(foodDir).getOrder(input.orderId);
    return { ...input, amountInr: order.amountInr, payeeName: order.payee.name, payeeVpa: order.payee.vpa };
  }).connect(new StdioServerTransport());
}

if (import.meta.main) {
  const [kind, dataDir, credentialId] = process.argv.slice(2);
  if (!kind || !dataDir) throw new Error("Connector kind and isolated data directory are required");
  await runIndiaConnector(kind, dataDir, credentialId);
}
