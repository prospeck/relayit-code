import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MockFoodProvider } from "../src/mock/provider.ts";
import { menus, restaurants } from "../src/mock/data.ts";
import { prepareOrder, previewPlaceOrder } from "../src/tools.ts";
import { createServer } from "../src/server.ts";
import type { CartInput } from "../src/provider.ts";

let dir: string;
let now: number;
let provider: MockFoodProvider;
const input: CartInput = {
  restaurantId: "california-pizza-kitchen",
  items: [
    { itemId: "california-pizza-kitchen-1", qty: 2 },
    { itemId: "california-pizza-kitchen-9", qty: 1 },
  ],
  deliveryAddress: { label: "Home", line: "12 Demo Road, Indiranagar" },
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "relayit-food-test-"));
  now = Date.parse("2026-11-01T12:00:00Z");
  provider = new MockFoodProvider(dir, () => now);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
describe("food catalogue", () => {
  it.each(["california pizza", "CPK", "calfornia pizza"])("resolves %s to CPK", async (query) => {
    expect((await provider.searchRestaurants({ query }))[0]?.id).toBe(input.restaurantId);
  });
  it("finds biryani and filters vegetarian restaurants, area, cuisine and ETA", async () => {
    const results = await provider.searchRestaurants({ query: "biryani" });
    expect(results.some((r) => r.id === "meghana-foods" && r.matchedDishes.length > 0)).toBe(true);
    const veg = await provider.searchRestaurants({ vegOnly: true });
    expect(veg.length).toBeGreaterThan(0);
    expect(veg.every((r) => restaurants.find((x) => x.id === r.id)?.pureVeg)).toBe(true);
    const filtered = await provider.searchRestaurants({
      area: "Indiranagar",
      cuisine: "Italian",
      maxEtaMin: 35,
    });
    expect(filtered.some((r) => r.id === input.restaurantId)).toBe(true);
    expect(filtered.every((r) => r.area === "Indiranagar" && r.etaMin <= 35)).toBe(true);
  });
  it("has 20 restaurants and 8–14 items per grouped menu", async () => {
    expect(restaurants).toHaveLength(20);
    for (const restaurant of restaurants) {
      const menu = await provider.getMenu(restaurant.id);
      const items = menu.categories.flatMap((c) => c.items);
      expect(items.length).toBeGreaterThanOrEqual(8);
      expect(items.length).toBeLessThanOrEqual(14);
      expect(items).toHaveLength(menus[restaurant.id]!.length);
      if (restaurant.pureVeg) expect(items.every((i) => i.veg)).toBe(true);
    }
  });
});
it("quotes exact line totals, GST and fees, with 30 minute expiry", async () => {
  const cart = await prepareOrder(provider, input);
  expect(cart.itemTotalInr).toBe(1315);
  expect(cart.gstInr).toBe(65.75);
  expect(cart.deliveryFeeInr).toBe(49);
  expect(cart.platformFeeInr).toBe(10);
  expect(cart.packagingInr).toBe(15);
  expect(cart.totalInr).toBe(1454.75);
  expect(cart.lines.map((l) => l.lineTotal)).toEqual([990, 325]);
  expect(Date.parse(cart.expiresAt) - now).toBe(30 * 60_000);
});
it("rounds fractional GST and the final total to two decimal places", async () => {
  const item = menus[input.restaurantId]![0]!;
  const originalPrice = item.priceInr;
  item.priceInr = 99.99;
  try {
    const cart = await provider.quote({ ...input, items: [{ itemId: item.id, qty: 3 }] });
    expect(cart.itemTotalInr).toBe(299.97);
    expect(cart.gstInr).toBe(15);
    expect(cart.totalInr).toBe(388.97);
  } finally {
    item.priceInr = originalPrice;
  }
});
it("rejects foreign menu items and invalid quantities", async () => {
  await expect(
    provider.quote({ ...input, items: [{ itemId: "meghana-foods-1", qty: 1 }] }),
  ).rejects.toThrow("does not belong");
  expect(() =>
    prepareOrder(provider, { ...input, items: [{ itemId: input.items[0]!.itemId, qty: 21 }] }),
  ).toThrow();
});
it("rejects expired carts at the exact expiry", async () => {
  const cart = await provider.quote(input);
  now += 30 * 60_000;
  await expect(provider.placeOrder(cart.cartId, "expired")).rejects.toThrow("expired");
});
it("places exactly one order per cart and replays the original result", async () => {
  const cart = await provider.quote(input);
  const [a, b] = await Promise.all([
    provider.placeOrder(cart.cartId, "key"),
    provider.placeOrder(cart.cartId, "key"),
  ]);
  expect(a).toEqual(b);
  expect(a.status).toBe("awaiting_payment");
  expect(a._parts).toEqual([]);
  await expect(provider.placeOrder(cart.cartId, "different")).rejects.toThrow(
    "cart already ordered",
  );
  await provider.confirmPayment(a.orderId, "demo-ref");
  now += 31 * 60_000;
  expect(await provider.placeOrder(cart.cartId, "key")).toEqual(a);
});
it.each(["__proto__", "constructor"])(
  "persists arbitrary idempotency key %s safely",
  async (key) => {
    const cart = await provider.quote(input);
    const order = await provider.placeOrder(cart.cartId, key);
    const restarted = new MockFoodProvider(dir, () => now);
    expect(await restarted.placeOrder(cart.cartId, key)).toEqual(order);
    const other = await restarted.quote(input);
    await expect(restarted.placeOrder(other.cartId, key)).rejects.toThrow("another cart");
  },
);
it("returns independent copies so callers cannot mutate stored prices or state", async () => {
  const cart = await provider.quote(input);
  cart.totalInr = 1;
  cart.lines[0]!.qty = 20;
  const stored = await provider.getCart(cart.cartId);
  expect(stored.totalInr).toBe(1454.75);
  expect(stored.lines[0]!.qty).toBe(2);
});
it("builds the approval preview from the stored cart", async () => {
  const cart = await provider.quote(input);
  const preview = await previewPlaceOrder(provider, { cartId: cart.cartId });
  expect(preview.amountInr).toBe(cart.totalInr);
  expect(preview.title).toBe("Order from California Pizza Kitchen");
  expect(preview.summary).toContain("3 items delivered to Home in about 35 min");
  expect(preview.details.find((d) => d.label === "Items")?.value).toBe(
    "2 × Margherita, 1 × Tiramisu",
  );
  expect(preview.details.find((d) => d.label === "Breakdown")?.value).toContain("1454.75");
});
it("advances status relative to payment time and confirms payment idempotently", async () => {
  const cart = await provider.quote(input);
  const order = await provider.placeOrder(cart.cartId);
  now += 60_000;
  const paid = await provider.confirmPayment(order.orderId, "demo-ref");
  expect(paid.status).toBe("confirmed");
  expect(await provider.confirmPayment(order.orderId, "demo-ref")).toEqual(paid);
  for (const [minutes, status] of [
    [2, "preparing"],
    [10, "out_for_delivery"],
    [35, "delivered"],
  ] as const) {
    now = Date.parse(paid.paidAt!) + minutes * 60_000;
    const current = await provider.getOrder(order.orderId);
    expect(current.status).toBe(status);
    expect(current.timeline.at(-1)?.status).toBe(status);
  }
});
it("persists carts, orders, payment and idempotency keys across restarts", async () => {
  const cart = await provider.quote(input);
  const restarted = new MockFoodProvider(dir, () => now);
  expect(await restarted.getCart(cart.cartId)).toEqual(JSON.parse(JSON.stringify(cart)));
  const order = await restarted.placeOrder(cart.cartId, "persisted-key");
  await restarted.confirmPayment(order.orderId, "demo-persisted-ref");
  const again = new MockFoodProvider(dir, () => now);
  expect((await again.getOrder(order.orderId)).status).toBe("confirmed");
  expect((await again.placeOrder(cart.cartId, "persisted-key")).orderId).toBe(order.orderId);
  await expect(again.placeOrder(cart.cartId, "new-key")).rejects.toThrow("cart already ordered");
});
it("serves MCP tools with all approval metadata and JSON results", async () => {
  const server = createServer(provider);
  const client = new Client({ name: "food-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(6);
    for (const tool of tools) {
      expect(["read", "prepare", "act"]).toContain(tool._meta?.["relayit/class"]);
      expect(tool._meta?.["relayit/service"]).toBe("RelayIt Food (demo)");
    }
    const act = tools.find((t) => t.name === "place_order")!;
    expect(act._meta).toMatchObject({
      "relayit/money": true,
      "relayit/previewTool": "preview_place_order",
    });
    const preview = tools.find((t) => t.name === "preview_place_order")!;
    expect(preview._meta?.["relayit/internal"]).toBeUndefined();
    expect(preview.inputSchema).toEqual(act.inputSchema);
    expect(tools.find((t) => t.name === "confirm_order_payment")).toBeUndefined();
    expect(act.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((t) => t.name === "get_menu")?.annotations?.readOnlyHint).toBe(true);
    const result = await client.callTool({
      name: "search_restaurants",
      arguments: { query: "CPK" },
    });
    expect(result.isError).not.toBe(true);
    expect(result.content).toHaveLength(1);
    const content = result.content as { type: string; text: string }[];
    expect(JSON.parse(content[0]!.text)[0].id).toBe(input.restaurantId);
    const error = await client.callTool({
      name: "get_menu",
      arguments: { restaurantId: "missing" },
    });
    expect(error.isError).toBe(true);
    expect(JSON.parse((error.content as { text: string }[])[0]!.text).error).toContain(
      "Unknown restaurant",
    );
  } finally {
    await client.close();
    await server.close();
  }
});

describe("search tolerates city names as area", () => {
  it("treats Bengaluru/Bangalore as no area filter and falls back when an area matches nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "relayit-food-area-"));
    try {
      const p = new MockFoodProvider(dir);
      for (const area of ["Bengaluru", "Bangalore", "Mars"]) {
        const r = await p.searchRestaurants({ query: "California Pizza", area });
        expect(r[0]?.name).toBe("California Pizza Kitchen");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
