// Renders every RelayIt icon from the Lane mark in shared/brand-mark.ts: the macOS and Windows app icons, the web and
// tray images, and the installer background. Run with `node scripts/make-brand-icons.mjs` after changing the mark.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Resvg } from "@resvg/resvg-js";
import { LANE_COLORS as C, LANE_RUNNER as R, LANE_STROKE, LANE_TRACK } from "../shared/brand-mark.ts";

const track = (stroke) => `<path d="${LANE_TRACK}" fill="none" stroke="${stroke}" stroke-width="${LANE_STROKE}" stroke-linecap="round"/>`;
const runner = (fill) => `<circle cx="${R.cx}" cy="${R.cy}" r="${R.r}" fill="${fill}"/>`;
// The app icon: the track in white on a coral tile, the runner in black.
const tile = `<rect width="64" height="64" rx="15" fill="${C.coral}"/>${track(C.white)}${runner(C.black)}`;
const svg = (inner, viewBox = "0 0 64 64", size = 1024) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}" role="img"><title>RelayIt</title>${inner}</svg>\n`;
const web = svg(tile);
// macOS draws an app icon inside a 824-point tile centred on 1024, so the tile is inset by 100.
const desktop = svg(`<g transform="translate(100 100) scale(12.875)">${tile}</g>`, "0 0 1024 1024");
// The menu bar wants a template image: black on transparent, which macOS recolours for light and dark bars.
const tray = svg(`${track("#000")}${runner("#000")}`, "4 4 56 56", 64);
const png = (source, size) => new Resvg(source, { fitTo: { mode: "width", value: size } }).render().asPng();

writeFileSync("build/icon.svg", desktop);
writeFileSync("public/app-icon.svg", web);
writeFileSync("build/icon.html", `<!doctype html><html lang="en"><meta charset="utf-8"><title>RelayIt icon</title><body style="margin:0;background:transparent">${desktop}</body></html>\n`);
writeFileSync("build/icon-1024.png", png(desktop, 1024));
writeFileSync("electron/resources/app-icon.png", png(web, 512));
writeFileSync("electron/resources/trayTemplate.png", png(tray, 18));
writeFileSync("electron/resources/trayTemplate@2x.png", png(tray, 36));
for (const name of ["16x16", "16x16@2x", "32x32", "32x32@2x", "64x64", "64x64@2x", "128x128", "128x128@2x", "256x256", "256x256@2x", "512x512", "512x512@2x"]) {
  const size = Number(name.split("x")[0]) * (name.includes("@2x") ? 2 : 1);
  writeFileSync(`build/icon.iconset/icon_${name}.png`, png(desktop, size));
}
execFileSync("iconutil", ["-c", "icns", "build/icon.iconset", "-o", "build/icon.icns"]);
for (const size of [192, 512]) writeFileSync(`public/app-icon-${size}.png`, png(web, size));
writeFileSync("public/apple-touch-icon.png", png(web, 180));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
const images = sizes.map((size, i) => {
  const bytes = png(web, size), entry = 6 + i * 16;
  header[entry] = header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(bytes.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += bytes.length;
  return bytes;
});
writeFileSync("build/icon.ico", Buffer.concat([header, ...images]));
execFileSync(process.execPath, ["build/dmg/render.mjs"], { stdio: "inherit" });
const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
manifest.name = manifest.short_name = "RelayIt";
manifest.theme_color = C.coral;
writeFileSync("public/manifest.webmanifest", JSON.stringify(manifest, null, 2) + "\n");
console.log("Rendered RelayIt desktop, web, tray, Windows and installer icons.");
