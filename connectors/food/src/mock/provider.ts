import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Cart, CartInput, FoodProvider, Order, Restaurant, SearchInput } from "../provider.ts";
import { menus, restaurants } from "./data.ts";

type State = {
  carts: Record<string, Cart>;
  orders: Record<string, Order>;
  keys: Record<string, Order>;
};
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++)
      next.push(Math.min(next[j]! + 1, row[j + 1]! + 1, row[j]! + (a[i] === b[j] ? 0 : 1)));
    row = next;
  }
  return row[b.length]!;
}
function match(query: string, text: string): number {
  const target = normalise(text);
  if (query === target) return 100;
  if (target.includes(query)) return 70;
  const words = target.split(" ");
  return query
    .split(" ")
    .every((q) => words.some((w) => w.includes(q) || (q.length >= 4 && distance(q, w) <= 1)))
    ? 40
    : 0;
}
export class MockFoodProvider implements FoodProvider {
  private readonly file: string;
  private readonly clock: () => number;
  private state: State;
  constructor(dataDir: string, clock: () => number = Date.now) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "food-state.json");
    this.clock = clock;
    try {
      this.state = JSON.parse(readFileSync(this.file, "utf8")) as State;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.state = { carts: {}, orders: {}, keys: {} };
    }
  }
  private save() {
    const temp = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state), { mode: 0o600 });
    renameSync(temp, this.file);
  }
  private restaurant(id: string): Restaurant {
    const restaurant = restaurants.find((r) => r.id === id);
    if (!restaurant) throw new Error(`Unknown restaurant: ${id}`);
    return restaurant;
  }
  async searchRestaurants(q: SearchInput) {
    // Models often pass the city as the "area"; areas are neighbourhoods. Ignore city names, and if a
    // real area filter removes everything, search the whole city instead of returning nothing.
    const area = q.area && !/^(bangalore|bengaluru|blr|bengaluru urban|karnataka)$/i.test(q.area.trim()) ? q.area : undefined;
    const results = this.search({ ...q, area });
    return results.length || !area ? results : this.search({ ...q, area: undefined });
  }
  private search(q: SearchInput) {
    const query = normalise(q.query ?? "");
    return restaurants
      .flatMap((r) => {
        if (q.vegOnly && !r.pureVeg) return [];
        if (q.area && !normalise(r.area).includes(normalise(q.area))) return [];
        if (q.maxEtaMin !== undefined && r.etaMin > q.maxEtaMin) return [];
        if (q.cuisine && !r.cuisines.some((c) => match(normalise(q.cuisine!), c))) return [];
        const matchedDishes = query
          ? menus[r.id]!.filter((d) => match(query, d.name)).map((d) => d.name)
          : [];
        const score = query
          ? Math.max(
              ...[r.name, ...r.aliases, ...r.cuisines].map((s) => match(query, s)),
              matchedDishes.length ? 50 : 0,
            )
          : 1;
        if (!score) return [];
        const { id, name, area, rating, etaMin, costForTwoInr, cuisines } = r;
        return [{ id, name, area, rating, etaMin, costForTwoInr, cuisines, matchedDishes, score }];
      })
      .sort((a, b) => b.score - a.score || b.rating - a.rating)
      .map(({ score: _, ...r }) => structuredClone(r));
  }
  async getMenu(restaurantId: string) {
    const restaurant = this.restaurant(restaurantId);
    const items = menus[restaurantId]!;
    return structuredClone({
      restaurant,
      categories: [...new Set(items.map((i) => i.category))].map((name) => ({
        name,
        items: items.filter((i) => i.category === name),
      })),
    });
  }
  async quote(input: CartInput): Promise<Cart> {
    const restaurant = this.restaurant(input.restaurantId);
    if (!input.items.length) throw new Error("Choose at least one menu item");
    if (!input.deliveryAddress.label.trim() || !input.deliveryAddress.line.trim())
      throw new Error("A delivery address label and line are required");
    const lines = input.items.map((line) => {
      const item = menus[restaurant.id]!.find((i) => i.id === line.itemId);
      if (!item) throw new Error(`Item ${line.itemId} does not belong to ${restaurant.name}`);
      if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > 20)
        throw new Error("Item quantity must be an integer from 1 to 20");
      return {
        itemId: item.id,
        name: item.name,
        qty: line.qty,
        unitPrice: item.priceInr,
        lineTotal: round(item.priceInr * line.qty),
        veg: item.veg,
        ...(line.note ? { note: line.note } : {}),
      };
    });
    const itemTotalInr = round(lines.reduce((n, l) => n + l.lineTotal, 0));
    const deliveryFeeInr = restaurant.etaMin <= 20 ? 0 : restaurant.etaMin <= 30 ? 29 : 49;
    const gstInr = round(itemTotalInr * 0.05);
    const packagingInr = 15;
    const platformFeeInr = 10;
    const cart: Cart = {
      cartId: randomUUID(),
      restaurant,
      lines,
      deliveryAddress: input.deliveryAddress,
      instructions: input.instructions,
      itemTotalInr,
      deliveryFeeInr,
      platformFeeInr,
      gstInr,
      packagingInr,
      totalInr: round(itemTotalInr + deliveryFeeInr + platformFeeInr + gstInr + packagingInr),
      etaMin: restaurant.etaMin,
      expiresAt: new Date(this.clock() + 30 * 60_000).toISOString(),
    };
    this.state.carts[cart.cartId] = structuredClone(cart);
    this.save();
    return structuredClone(cart);
  }
  async getCart(cartId: string) {
    const cart = Object.hasOwn(this.state.carts, cartId) ? this.state.carts[cartId] : undefined;
    if (!cart) throw new Error("Cart not found; prepare an order first");
    return structuredClone(cart);
  }
  async placeOrder(cartId: string, idempotencyKey?: string): Promise<Order> {
    if (idempotencyKey !== undefined && !idempotencyKey.trim())
      throw new Error("idempotencyKey must not be empty");
    const original =
      idempotencyKey && Object.hasOwn(this.state.keys, idempotencyKey)
        ? this.state.keys[idempotencyKey]
        : undefined;
    if (original) {
      if (original.cartId !== cartId) throw new Error("Idempotency key belongs to another cart");
      return structuredClone(original);
    }
    const cart = Object.hasOwn(this.state.carts, cartId) ? this.state.carts[cartId] : undefined;
    if (!cart) throw new Error("Cart not found; prepare an order first");
    if (Object.values(this.state.orders).some((o) => o.cartId === cartId))
      throw new Error("cart already ordered");
    if (Date.parse(cart.expiresAt) <= this.clock())
      throw new Error("Cart expired; prepare a fresh order");
    const createdAt = new Date(this.clock()).toISOString();
    const order: Order = {
      orderId: randomUUID(),
      cartId,
      status: "awaiting_payment",
      amountInr: cart.totalInr,
      restaurant: cart.restaurant,
      payee: {
        name: `${cart.restaurant.name} (demo)`,
        vpa: `${cart.restaurant.id}@okaxis`,
        merchantCode: "5812",
      },
      etaMin: cart.etaMin,
      createdAt,
      timeline: [{ status: "awaiting_payment", at: createdAt }],
      _parts: [],
    };
    this.state.orders[order.orderId] = order;
    if (idempotencyKey)
      Object.defineProperty(this.state.keys, idempotencyKey, {
        value: structuredClone(order),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    this.save();
    return structuredClone(order);
  }
  async getOrder(orderId: string) {
    const order = Object.hasOwn(this.state.orders, orderId)
      ? this.state.orders[orderId]
      : undefined;
    if (!order) throw new Error("Order not found");
    const result = structuredClone(order);
    if (order.paidAt) {
      const paid = Date.parse(order.paidAt);
      const stages = [
        { status: "preparing" as const, minutes: 2 },
        { status: "out_for_delivery" as const, minutes: 10 },
        { status: "delivered" as const, minutes: order.etaMin },
      ];
      for (const stage of stages)
        if (this.clock() >= paid + stage.minutes * 60_000) {
          result.status = stage.status;
          result.timeline.push({
            status: stage.status,
            at: new Date(paid + stage.minutes * 60_000).toISOString(),
          });
        }
    }
    return result;
  }
  async confirmPayment(orderId: string, paymentRef: string) {
    if (!paymentRef.trim()) throw new Error("Payment reference is required");
    const order = Object.hasOwn(this.state.orders, orderId)
      ? this.state.orders[orderId]
      : undefined;
    if (!order) throw new Error("Order not found");
    if (!order.paidAt) {
      order.paidAt = new Date(this.clock()).toISOString();
      order.paymentRef = paymentRef;
      order.status = "confirmed";
      order.timeline.push({ status: "confirmed", at: order.paidAt });
      this.save();
    }
    return this.getOrder(orderId);
  }
}
