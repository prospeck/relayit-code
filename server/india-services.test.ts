import { isMoneyTool } from "../shared/outbound.ts";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createMockCheckoutHandler } from "../connectors/payments/src/mockCheckout.ts";
import { MockFoodProvider } from "../connectors/food/src/mock/provider.ts";
import { gateServer } from "./mcp-gate-config.ts";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { indiaFreeTools, indiaServiceSpec } from "./india-services.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

async function connect(kind: string, dir: string, mockCheckoutBaseUrl?: string) {
  const spec = indiaServiceSpec(kind, dir, undefined, mockCheckoutBaseUrl)!;
  const client = new Client({ name: "india-services-test", version: "1" });
  await client.connect(new StdioClientTransport({ command: spec.server.command, args: spec.server.args, env: { PATH: process.env.PATH ?? "", OMB_DATA_DIR: dir, ...spec.server.env }, stderr: "ignore" }));
  return client;
}
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  return JSON.parse((result.content as { text: string }[])[0]!.text);
}

describe("shipped India stdio servers", () => {
  it("hides preview-only tools at the native CLI boundary even when result trimming is disabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "india-preview-visibility-")); dirs.push(dir);
    const spec = indiaServiceSpec("food", dir)!;
    const gate = gateServer({ name: spec.name, server: spec.server, threadId: "preview-visibility", budget: 0 })!;
    const client = new Client({ name: "preview-visibility-test", version: "1" });
    try {
      await client.connect(new StdioClientTransport({ command: gate.command, args: gate.args, env: { PATH: process.env.PATH ?? "", ...gate.env }, stderr: "ignore" }));
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("place_order");
      expect(tools.map((tool) => tool.name)).not.toContain("preview_place_order");
    } finally { await client.close(); }
  });
  it("keeps the hosted mock checkout alive between MCP turns and reconciles it after reconnecting", async () => {
    const dir = mkdtempSync(join(tmpdir(), "india-checkout-lifetime-")); dirs.push(dir);
    const provider = new MockFoodProvider(join(dir, "india-services", "food"));
    const restaurant = (await provider.searchRestaurants({ query: "California Pizza" }))[0]!;
    const menu = await provider.getMenu(restaurant.id);
    const cart = await provider.quote({ restaurantId: restaurant.id, items: [{ itemId: menu.categories[0]!.items[0]!.id, qty: 1 }], deliveryAddress: { label: "Home", line: "12 Demo Road, Bengaluru" } });
    const order = await provider.placeOrder(cart.cartId);
    let origin = "";
    const handler = createMockCheckoutHandler({ origin: () => origin, prefix: "/api/india/mock-checkout" });
    const host = createServer((req, res) => { void handler(req, res); });
    await new Promise<void>((resolve) => host.listen(0, "127.0.0.1", resolve));
    const address = host.address();
    if (!address || typeof address === "string") throw new Error("Fixture did not bind");
    origin = `http://127.0.0.1:${address.port}/api/india/mock-checkout`;
    let payments: Client | undefined;
    try {
      payments = await connect("payments", dir, `${origin}/v1`);
      const payment = await call(payments, "payments_create_request", { orderId: order.orderId, amountInr: order.amountInr, payeeName: order.payee.name, payeeVpa: order.payee.vpa, note: "Demo only" });
      await payments.close(); payments = undefined;
      expect((await fetch(payment.checkoutUrl)).status).toBe(200);
      expect((await fetch(`${payment.checkoutUrl}/complete`, { method: "POST" })).status).toBe(200);
      payments = await connect("payments", dir, `${origin}/v1`);
      expect((await call(payments, "payments_check_status", { paymentId: payment.id })).status).toBe("paid");
      expect((await provider.getOrder(order.orderId)).status).toBe("confirmed");
    } finally {
      await payments?.close();
      host.closeAllConnections();
      await new Promise<void>((resolve) => host.close(() => resolve()));
    }
  });
  it("resolves California Pizza, quotes a mock order, reconciles only a mock-paid checkout and persists the result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "india-stdio-")); dirs.push(dir);
    const food = await connect("food", dir);
    let payments: Client | undefined;
    try {
      const found = await call(food, "search_restaurants", { query: "California Pizza" });
      const restaurantId = found[0].id;
      const menu = await call(food, "get_menu", { restaurantId });
      const cart = await call(food, "prepare_order", { restaurantId, items: [{ itemId: menu.categories[0].items[0].id, qty: 1 }], deliveryAddress: { label: "Demo home", line: "12 Demo Road, Bengaluru" } });
      const order = await call(food, "place_order", { cartId: cart.cartId, idempotencyKey: "fixture-order" });
      payments = await connect("payments", dir);
      const payment = await call(payments, "payments_create_request", { orderId: order.orderId, amountInr: order.amountInr, payeeName: order.payee.name, payeeVpa: order.payee.vpa, note: "Demo only" });
      expect(payment.demo).toBe(true);
      expect(payment.checkoutUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
      await call(payments, "payments_mark_paid_by_user", { paymentId: payment.id });
      expect((await call(food, "get_order_status", { orderId: order.orderId })).status).toBe("awaiting_payment");
      await fetch(`${payment.checkoutUrl}/complete`, { method: "POST" });
      expect((await call(payments, "payments_check_status", { paymentId: payment.id })).status).toBe("paid");
      expect((await call(food, "get_order_status", { orderId: order.orderId })).status).toBe("confirmed");
      await payments.close(); payments = await connect("payments", dir);
      expect((await call(payments, "payments_check_status", { orderId: order.orderId })).status).toBe("paid");
    } finally { await payments?.close(); await food.close(); }
  });
  it("ships travel read tools and keeps built-ins optional", async () => {
    const dir = mkdtempSync(join(tmpdir(), "india-travel-")); dirs.push(dir);
    expect(indiaServiceSpec("unknown", dir)).toBeNull();
    expect(indiaServiceSpec("travel", dir)?.server.enabled).toBe(false);
    const client = await connect("travel", dir);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("metro_route");
      expect(tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);
      expect(await call(client, "resolve_station", { query: "Bangalore" })).not.toEqual([]);
    } finally { await client.close(); }
  });
});

it("bundles the shipped stdio entry and starts the selected connector only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "india-bundle-")); dirs.push(dir);
  const entry = join(dir, "india-connectors.mjs");
  await build({ entryPoints: ["server/india-connectors.ts"], outfile: entry, bundle: true, platform: "node", format: "esm", target: "node24", logLevel: "silent", banner: { js: 'import { createRequire as __ombCreateRequire } from "node:module"; const require = __ombCreateRequire(import.meta.url);' } });
  const client = new Client({ name: "bundle-test", version: "1" });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry, "travel", dir], env: { PATH: process.env.PATH ?? "", OMB_DATA_DIR: dir }, stderr: "inherit" }));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
    expect(tools.map((tool) => tool.name)).toContain("metro_route");
  } finally { await client.close(); }
});

it("lets our own connectors look things up without a card, and nothing that spends", () => {
  const { server } = indiaServiceSpec("food", "/tmp/x")!;
  const free = indiaFreeTools("india-food", server)!;
  expect([...free]).toEqual(expect.arrayContaining(["search_restaurants", "get_menu", "prepare_order"]));
  expect(free.has("place_order")).toBe(false);
  for (const tool of [...free, ...indiaFreeTools("india-travel", indiaServiceSpec("travel", "/tmp/x")!.server)!]) {
    expect(isMoneyTool(tool), tool).toBe(false);
  }
  expect(indiaFreeTools("india-payments", indiaServiceSpec("payments", "/tmp/x")!.server)).toBeUndefined();
});

it("doesn't let another server borrow the name", () => {
  expect(indiaFreeTools("india-food", { command: "node", args: ["my-server.js"] })).toBeUndefined();
  expect(indiaFreeTools("india-food", { type: "http", url: "https://evil.example/mcp" })).toBeUndefined();
  expect(indiaFreeTools("something-else", indiaServiceSpec("food", "/tmp/x")!.server)).toBeUndefined();
});
