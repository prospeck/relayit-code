#!/usr/bin/env node
/**
 * Prepares the core sidecar for a release build:
 *  - bundles packages/core into src-tauri/resources/core/main.mjs
 *  - bundles the built-in MCP servers into resources/core/connectors/*.mjs
 *  - copies playwright-core (loaded at runtime by the browser agent)
 *  - copies this machine's Node runtime as the `relayit-node` sidecar binary
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, copyFileSync, chmodSync, existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tauri = join(root, "apps/desktop/src-tauri");
const out = join(tauri, "resources/core");
const require = createRequire(import.meta.url);

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "connectors"), { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  minifySyntax: true,
  legalComments: "none",
  external: ["playwright-core", "chromium-bidi", "electron"],
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  logLevel: "warning",
};

await build({ ...common, entryPoints: [join(root, "packages/core/src/main.ts")], outfile: join(out, "main.mjs") });
for (const name of ["food", "travel"]) {
  await build({ ...common, entryPoints: [join(root, `connectors/${name}/src/server.ts`)], outfile: join(out, `connectors/${name}.mjs`) });
}

// playwright-core is pure JS; ship it beside main.mjs so `import("playwright-core")` resolves.
try {
  const pw = dirname(realpathSync(require.resolve("playwright-core/package.json")));
  cpSync(pw, join(out, "node_modules/playwright-core"), { recursive: true, dereference: true });
} catch {
  console.warn("[bundle] playwright-core not found; the browser agent will be unavailable in this build");
}

// Tauri sets TAURI_ENV_TARGET_TRIPLE during `tauri build`; otherwise ask rustc (also checked in ~/.cargo/bin).
const rustc = existsSync(join(homedir(), ".cargo/bin/rustc")) ? join(homedir(), ".cargo/bin/rustc") : "rustc";
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || execFileSync(rustc, ["-vV"], { encoding: "utf8" }).match(/host: (.+)/)[1].trim();
mkdirSync(join(tauri, "binaries"), { recursive: true });
const bin = join(tauri, "binaries", `relayit-node-${triple}${process.platform === "win32" ? ".exe" : ""}`);
if (existsSync(bin)) rmSync(bin);
copyFileSync(process.execPath, bin);
chmodSync(bin, 0o755);
console.log(`[bundle] core → ${out}\n[bundle] node ${process.version} → ${bin}`);
