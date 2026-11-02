import { isMoneyTool } from "../shared/outbound.ts";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { indiaFreeTools, indiaServiceSpec } from "./india-services.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

async function connect(kind: string, dir: string) {
  const spec = indiaServiceSpec(kind, dir)!;
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
