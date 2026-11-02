import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { FoodProvider } from "./provider.ts";

const text = z.string().trim().min(1);
export const searchSchema = z.object({
  query: z.string().optional(),
  area: text.optional(),
  vegOnly: z.boolean().optional(),
  maxEtaMin: z.number().positive().optional(),
  cuisine: text.optional(),
});
export const cartSchema = z.object({
  restaurantId: text,
  items: z
    .array(
      z.object({ itemId: text, qty: z.number().int().min(1).max(20), note: z.string().optional() }),
    )
    .min(1),
  deliveryAddress: z.object({ label: text, line: text }),
  instructions: z.string().optional(),
});
export const placeSchema = z.object({ cartId: text, idempotencyKey: text.optional() });
const restaurantSchema = z.object({ restaurantId: text });
const orderSchema = z.object({ orderId: text });
const paymentSchema = z.object({ orderId: text, paymentRef: text });
export async function previewPlaceOrder(
  provider: FoodProvider,
  input: z.infer<typeof placeSchema>,
) {
  const cart = await provider.getCart(input.cartId);
  const n = cart.lines.reduce((sum, line) => sum + line.qty, 0);
  return {
    title: `Order from ${cart.restaurant.name}`,
    summary: `${n} item${n === 1 ? "" : "s"} delivered to ${cart.deliveryAddress.label} in about ${cart.etaMin} min. You'll pay on the next screen.`,
    service: "RelayIt Food (demo)",
    recipient: cart.restaurant.name,
    amountInr: cart.totalInr,
    details: [
      { label: "Items", value: cart.lines.map((l) => `${l.qty} × ${l.name}`).join(", ") },
      { label: "Deliver to", value: `${cart.deliveryAddress.label}: ${cart.deliveryAddress.line}` },
      { label: "ETA", value: `${cart.etaMin} min` },
      {
        label: "Breakdown",
        value: `Items ₹${cart.itemTotalInr.toFixed(2)} + delivery ₹${cart.deliveryFeeInr.toFixed(2)} + platform ₹${cart.platformFeeInr.toFixed(2)} + GST ₹${cart.gstInr.toFixed(2)} + packaging ₹${cart.packagingInr.toFixed(2)} = ₹${cart.totalInr.toFixed(2)}`,
      },
    ],
  };
}
export const searchRestaurants = (p: FoodProvider, input: z.infer<typeof searchSchema>) =>
  p.searchRestaurants(searchSchema.parse(input));
export const getMenu = (p: FoodProvider, input: { restaurantId: string }) =>
  p.getMenu(restaurantSchema.parse(input).restaurantId);
export const prepareOrder = (p: FoodProvider, input: z.infer<typeof cartSchema>) =>
  p.quote(cartSchema.parse(input));
export const placeOrder = (p: FoodProvider, input: z.infer<typeof placeSchema>) => {
  const args = placeSchema.parse(input);
  return p.placeOrder(args.cartId, args.idempotencyKey);
};
export const getOrderStatus = (p: FoodProvider, input: { orderId: string }) =>
  p.getOrder(orderSchema.parse(input).orderId);
export const confirmOrderPayment = (p: FoodProvider, input: z.infer<typeof paymentSchema>) => {
  const args = paymentSchema.parse(input);
  return p.confirmPayment(args.orderId, args.paymentRef);
};
async function result(fn: () => unknown | Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn()) }] };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        },
      ],
    };
  }
}
const meta = (classification: string, label: string) => ({
  "relayit/class": classification,
  "relayit/service": "RelayIt Food (demo)",
  "relayit/label": label,
});
export function registerTools(server: McpServer, provider: FoodProvider) {
  server.registerTool(
    "search_restaurants",
    {
      description:
        "First step for any food order: find restaurants by name, alias, cuisine or dish (demo Bengaluru catalogue). Copy the returned id into get_menu; never invent a restaurantId. Leave area empty unless the user named a neighbourhood.",
      inputSchema: searchSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: meta("read", "Searching restaurants"),
    },
    (input) => result(() => searchRestaurants(provider, input)),
  );
  server.registerTool(
    "get_menu",
    {
      description:
        "Read the chosen restaurant's menu before building a cart. Copy exact item ids from this result; dish names or guessed ids are not valid itemId values.",
      inputSchema: restaurantSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: meta("read", "Reading the menu"),
    },
    (input) => result(() => getMenu(provider, input)),
  );
  server.registerTool(
    "prepare_order",
    {
      description:
        "Build a cart only after search_restaurants and get_menu, using their exact restaurantId and itemId values and a saved delivery address. Returns cartId and the total (fees + GST included, valid 30 min). Next call place_order with that cartId — that shows the approval card.",
      inputSchema: cartSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: meta("prepare", "Building your cart"),
    },
    (input) => result(() => prepareOrder(provider, input)),
  );
  server.registerTool(
    "preview_place_order",
    {
      description: "Preview the stored cart for order approval.",
      inputSchema: placeSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: meta("read", "Reviewing your order"),
    },
    (input) => result(() => previewPlaceOrder(provider, input)),
  );
  server.registerTool(
    "place_order",
    {
      description:
        "Place the order for a prepared cart (pass its cartId). Requires the app’s money approval; payment then happens in the person’s own UPI app. Demo orders only.",
      inputSchema: placeSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      _meta: {
        ...meta("act", "Placing your order"),
        "relayit/money": true,
        "relayit/previewTool": "preview_place_order",
      },
    },
    (input) => result(() => placeOrder(provider, input)),
  );
  server.registerTool(
    "get_order_status",
    {
      description: "Read the demo order status and timeline.",
      inputSchema: orderSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: meta("read", "Checking your order"),
    },
    (input) => result(() => getOrderStatus(provider, input)),
  );

}
