// Dev helper: screenshot the web UI with the system Chrome. Usage: node scripts/shot.mjs <hash> <out.png> [dark] [w] [h] [js]
import { chromium } from "playwright-core";
const [hash = "", out = "/tmp/shot.png", scheme = "light", w = "1280", h = "820", js = ""] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, colorScheme: scheme === "dark" ? "dark" : "light", deviceScaleFactor: 2 });
await page.goto(`http://127.0.0.1:1420/#/${hash}`);
await page.waitForTimeout(1200);
if (js) { await page.evaluate(js); await page.waitForTimeout(1500); }
await page.screenshot({ path: out });
await browser.close();
console.log(out);
