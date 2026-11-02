import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.ts";
import { createInput, lookupInput, confirmInput, paymentOutput } from "../src/tools.ts";

const input = { orderId: "order-tools", amountInr: 450, payeeName: "Asha", payeeVpa: "asha@bank", note: "Groceries" };
it("validates payment input, lookup and UTR", () => {
  expect(createInput.safeParse({ ...input, amountInr: 1.001 }).success).toBe(false);
  expect(createInput.safeParse({ ...input, payeeVpa: "invalid" }).success).toBe(false);
  expect(lookupInput.safeParse({}).success).toBe(false);
  expect(lookupInput.safeParse({ paymentId: "p", orderId: "o" }).success).toBe(false);
  expect(confirmInput.safeParse({ paymentId: "p", utr: "123" }).success).toBe(false);
});
describe("payment MCP tools", () => {
  it("returns compact card data, retries idempotently and never treats a UPI assertion as verified", async () => {
    const server = createServer();
    const client = new Client({ name: "test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b); await client.connect(a);
    async function call(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      return JSON.parse((result.content as { text: string }[])[0]!.text);
    }
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(5);
      expect(tools.filter((tool) => tool._meta?.["relayit/previewOnly"] === true)).toHaveLength(2);
      expect(tools.find((tool) => tool.name === "payments_mark_paid_by_user")?.annotations?.readOnlyHint).toBe(false);
      const payment = await call("payments_create_request", input);
      expect(payment).toMatchObject({ type: "payment", status: "pending", amountInr: 450 });
      expect(payment.upiUri).toContain("upi://pay?");
      expect(payment).not.toHaveProperty("qrSvg");
      expect((await call("payments_create_request", input)).id).toBe(payment.id);
      expect((await call("payments_check_status", { orderId: input.orderId })).id).toBe(payment.id);
      expect((await call("payments_mark_paid_by_user", { paymentId: payment.id, utr: "123456789012" })).status).toBe("user_confirmed");
      expect((await call("payments_check_status", { paymentId: payment.id })).status).toBe("user_confirmed");
    } finally { await client.close(); await server.close(); }
  });
});

it("never hands the model a payable link for a demo merchant", () => {
  const base = { id: "p", orderId: "o", amountInr: 100, payeeVpa: "cpk@demo.invalid", status: "pending", upiUri: "upi://pay?pa=cpk%40demo.invalid", checkoutUrl: "http://127.0.0.1:1/x", externalRef: null } as never;
  const demo = paymentOutput({ ...(base as object), payeeName: "CPK (demo)" } as never);
  expect(demo.upiUri).toBeNull();
  expect(JSON.stringify(demo)).not.toContain("upi://");
  expect(paymentOutput({ ...(base as object), payeeName: "A real shop" } as never).upiUri).toContain("upi://pay?");
});
