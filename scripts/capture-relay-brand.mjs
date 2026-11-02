import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright-core");

const url = process.argv[2];
if (!url || new URL(url).hostname !== "127.0.0.1") throw new Error("Pass the isolated brand fixture's loopback preview URL.");
await mkdir("docs/brand-review", { recursive: true });
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(10000);
  await page.addInitScript(() => localStorage.setItem("omb-advanced-mode", "0"));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const theme of ["light", "dark"]) {
    const target = new URL(url);
    target.searchParams.set("theme", theme);
    await page.goto(target.href);
    await page.waitForTimeout(2500);
    const done = page.getByRole("button", { name: "Done", exact: true });
    if (await done.count()) await done.click();
    await page.locator("[data-sidebar-bot-row]").filter({ hasText: "Atlas" }).click();
    await page.waitForTimeout(700);
    console.log(theme, (await page.locator("body").innerText()).slice(-900));
    await page.screenshot({ path: `docs/brand-review/chat-${theme}.png` });
    await page.getByRole("button", { name: "Open Atlas's profile", exact: true }).first().click();
    await page.locator("[data-panel-avatar]").click();
    await page.locator("[data-avatar-more]").click();
    await page.waitForSelector("[data-avatar-more-looks]");
    await page.screenshot({ path: `docs/brand-review/look-${theme}.png` });
    target.searchParams.set("cursor", "1");
    await page.goto(target.href);
    await page.waitForSelector("[data-agent-cursor]");
    await page.screenshot({ path: `docs/brand-review/computer-${theme}.png` });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(100);
  const reduced = await page.locator('[data-relay-token][data-activity="working"]').first().getAttribute("data-animated");
  if (reduced !== "false") throw new Error("Reduced-motion preference did not stop token animation");
  console.log(JSON.stringify({ errors, reducedMotion: "passed", screenshots: 6 }));
  if (errors.length) throw new Error("Browser page errors occurred");
} finally {
  await browser.close();
}
