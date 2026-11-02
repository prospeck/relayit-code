import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "relayit-order-cards-"));
process.env.HOME = home;
process.env.OMB_DATA_DIR = join(home, "data");
const { mountChatTools } = await import("../server/drivers/chat-mcp-tools.ts");
const { indiaServiceSpec } = await import("../server/india-services.ts");
const { mountPreview, parkUntilSignal } = await import("./testing/preview-fixture.ts");
const session = await mountChatTools({ custom: {
  "india-food": indiaServiceSpec("food", process.env.OMB_DATA_DIR)!.server,
  "india-payments": indiaServiceSpec("payments", process.env.OMB_DATA_DIR)!.server,
} }, new AbortController().signal);
const run = async (name: string, input: Record<string, unknown>) => {
  const result = await session.execute(name, input, AbortSignal.timeout(15_000));
  if (!result.ok) throw new Error(result.text);
  return JSON.parse(result.text);
};
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  const [restaurant] = await run("india_food_search_restaurants", { query: "California Pizza" });
  const menu = await run("india_food_get_menu", { restaurantId: restaurant.id });
  const items = menu.categories.flatMap((category: { items: { id: string }[] }) => category.items);
  const cart = await run("india_food_prepare_order", { restaurantId: restaurant.id, items: [items[0], items[1]].map((item) => ({ itemId: item.id, qty: 1 })), deliveryAddress: { label: "Home", line: "12 Demo Road, Bengaluru" } });
  const summary = await session.approvalSummary("india_food_place_order", { cartId: cart.cartId });
  const order = await run("india_food_place_order", { cartId: cart.cartId });
  const payment = await run("india_payments_payments_create_request", { orderId: order.orderId, amountInr: order.amountInr, payeeName: order.payee.name, payeeVpa: order.payee.vpa, note: "Demo only" });
  preview = await mountPreview({ info: { url: "http://127.0.0.1:9" } }, {
    entry: "/scripts/testing/order-card-preview.tsx", route: "/__order-cards.html", title: "Mock order cards",
    extraRoutes: [{ path: "/__order-cards.json", handler: (_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ summary, payment })); } }],
  });
  console.log(preview.previewUrl);
  if (process.argv.includes("--capture")) {
    const { openHeadlessChrome } = await import("./testing/headless-chrome.ts");
    const profile = join(home, "chrome");
    mkdirSync(profile);
    const page = await openHeadlessChrome(profile);
    const images = "docs/verification/images/order-cards";
    mkdirSync(images, { recursive: true });
    try {
      await page.send("Emulation.setDeviceMetricsOverride", { width: 1050, height: 1100, deviceScaleFactor: 1, mobile: false });
      for (const theme of ["light", "dark"]) {
        await page.send("Page.navigate", { url: `${preview.previewUrl}?theme=${theme}` });
        await page.until('document.querySelector("[data-ask-card=approval]") && document.querySelector("svg[role=img]")');
        const valid = await page.evaluate('document.body.innerText.includes("Total: ₹") && document.documentElement.scrollWidth === innerWidth');
        if (!valid) throw new Error("Card total missing or horizontal overflow");
        writeFileSync(join(images, `${theme}.png`), await page.capture());
        console.log(`${theme}: total visible, QR present, no horizontal overflow`);
      }
    } finally { page.close(); }
  } else await parkUntilSignal();
} finally {
  await preview?.close();
  await session.close();
  rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
