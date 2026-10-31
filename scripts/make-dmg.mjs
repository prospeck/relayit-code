#!/usr/bin/env node
// Builds a simple drag-to-Applications DMG from the release .app with hdiutil.
// (Tauri's styled DMG scripts Finder via AppleScript, which fails on headless/CI machines.)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("DMGs can only be built on macOS");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "apps/desktop/src-tauri/target/release/bundle");
const app = join(bundle, "macos/RelayIt.app");
if (!existsSync(app)) throw new Error("Build the app first: pnpm tauri build --bundles app");
const version = JSON.parse(execFileSync("node", ["-p", "JSON.stringify(require('./apps/desktop/src-tauri/tauri.conf.json').version)"], { cwd: root, encoding: "utf8" }));
const arch = process.arch === "arm64" ? "aarch64" : "x64";
const outDir = join(bundle, "dmg");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `RelayIt_${version}_${arch}.dmg`);

const stage = mkdtempSync(join(tmpdir(), "relayit-dmg-"));
try {
  cpSync(app, join(stage, "RelayIt.app"), { recursive: true, verbatimSymlinks: true });
  symlinkSync("/Applications", join(stage, "Applications"));
  rmSync(out, { force: true });
  execFileSync("hdiutil", ["create", "-volname", "RelayIt", "-srcfolder", stage, "-ov", "-format", "UDZO", "-fs", "HFS+", out], { stdio: "inherit" });
  console.log(`[dmg] ${out}`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
