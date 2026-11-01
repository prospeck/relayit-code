import { chromium } from "playwright-core";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
// macOS-style app icon: rounded square with inner margin.
await p.setContent(
  `<html><body style="margin:0;background:transparent"><svg width="1024" height="1024" viewBox="0 0 1024 1024"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F3784A"/><stop offset="1" stop-color="#D4441C"/></linearGradient></defs><rect x="100" y="100" width="824" height="824" rx="190" fill="url(#g)"/><g transform="translate(100,100) scale(12.875)"><path d="M21 45V19h12.5a8.5 8.5 0 0 1 0 17H27m7 0 9.5 9" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/></g></svg></body></html>`,
);
await p.screenshot({ path: join(tmpdir(), "relayit-icon.png"), omitBackground: true });
await p.setViewportSize({ width: 44, height: 44 });
await p.setContent(
  `<html><body style="margin:0;background:transparent"><svg width="44" height="44" viewBox="0 0 64 64"><path d="M21 47V17h13a9 9 0 0 1 0 18H27m7.5 0 10 10" fill="none" stroke="#000" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/></svg></body></html>`,
);
await p.screenshot({
  path: fileURLToPath(new URL("../apps/desktop/src-tauri/icons/tray.png", import.meta.url)),
  omitBackground: true,
});
await b.close();
