#!/usr/bin/env node
/**
 * Prepares the core sidecar for a release build:
 *  - bundles packages/core into src-tauri/resources/core/main.mjs
 *  - bundles the built-in MCP servers into resources/core/connectors/*.mjs
 *  - copies playwright-core (loaded at runtime by the browser agent)
 *  - downloads the official Node runtime as the `relayit-node` sidecar binary
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, copyFileSync, chmodSync, existsSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
const cargoRustc = join(homedir(), ".cargo", "bin", process.platform === "win32" ? "rustc.exe" : "rustc");
const rustc = existsSync(cargoRustc) ? cargoRustc : "rustc";
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || execFileSync(rustc, ["-vV"], { encoding: "utf8" }).match(/host: (.+)/)[1].trim();
mkdirSync(join(tauri, "binaries"), { recursive: true });
const bin = join(tauri, "binaries", `relayit-node-${triple}${triple.includes("windows") ? ".exe" : ""}`);
if (existsSync(bin)) rmSync(bin);
copyFileSync(await officialNode(triple), bin);
if (process.platform !== "win32") chmodSync(bin, 0o755);

/**
 * The sidecar must be a self-contained Node (package-manager builds link to shared libraries).
 * Downloads the official build of the running Node version for the target, verifies its SHA-256
 * against nodejs.org's SHASUMS256.txt, and caches it.
 */
async function officialNode(targetTriple) {
  const version = process.env.RELAYIT_NODE_VERSION || process.version;
  const plat = targetTriple.includes("apple-darwin") ? "darwin" : targetTriple.includes("windows") ? "win" : "linux";
  const arch = targetTriple.startsWith("aarch64") ? "arm64" : "x64";
  const base = `node-${version}-${plat}-${arch}`;
  const file = plat === "win" ? `${base}.zip` : `${base}.tar.gz`;
  const cacheDir = join(homedir(), ".cache", "relayit-node", base);
  const exe = join(cacheDir, plat === "win" ? "node.exe" : "bin/node");
  if (existsSync(exe)) return exe;
  mkdirSync(cacheDir, { recursive: true });
  const url = `https://nodejs.org/dist/${version}/${file}`;
  console.log(`[bundle] downloading ${url}`);
  const [sums, archive] = await Promise.all([
    fetch(`https://nodejs.org/dist/${version}/SHASUMS256.txt`).then((r) => { if (!r.ok) throw new Error(`SHASUMS ${r.status}`); return r.text(); }),
    fetch(url).then(async (r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return Buffer.from(await r.arrayBuffer()); }),
  ]);
  const expected = sums.split("\n").find((l) => l.endsWith(`  ${file}`))?.split(/\s+/)[0];
  const actual = createHash("sha256").update(archive).digest("hex");
  if (!expected || expected !== actual) throw new Error(`Checksum mismatch for ${file}`);
  const archivePath = join(cacheDir, file);
  writeFileSync(archivePath, archive);
  // Windows' bsdtar reads zip too: node-vX-win-x64/node.exe becomes cacheDir/node.exe.
  if (plat === "win") execFileSync("tar", ["-xf", archivePath, "-C", cacheDir, "--strip-components=1", `${base}/node.exe`]);
  else execFileSync("tar", ["-xzf", archivePath, "-C", cacheDir, "--strip-components=1", `${base}/bin/node`]);
  rmSync(archivePath);
  return exe;
}
console.log(`[bundle] core → ${out}\n[bundle] node → ${bin}`);
