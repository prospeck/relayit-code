#!/usr/bin/env node
// Renames the product to RelayIt across the tree. Dry run by default; pass --apply to write.
// Run it after other work has merged: it is safe to run again and only touches tracked files.
//
// It never rewrites a web address. A leftover upstream host would otherwise become a relayit
// domain we don't own, so hosts are reported and fail the run until someone removes them.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Required by Apache-2.0 sections 4 and 6, or describing where the code came from. */
const KEEP = [/^LICENSE$/, /^NOTICE$/, /^UPSTREAM\.md$/, /^LICENSING\.md$/, /^third_party\//, /^pnpm-lock\.yaml$/, /^shared\/package-fixtures\//, /^scripts\/rebrand-to-relayit/, /^scripts\/check-no-upstream/];
const BINARY = /\.(png|jpe?g|gif|webp|ico|icns|ttf|otf|woff2?|mp3|mp4|wav|webm|pdf|zip|gz|tgz|wasm|node|dylib|exe|jar)$/i;

const NAMES = [
  [/Open ?Maus ?Bot/g, "RelayIt"],
  [/Open Maus\b/g, "RelayIt"],
  [/OPENMAUSBOT/g, "RELAYIT"],
  [/OpenMausBot/g, "RelayIt"],
  [/openmausbot/g, "relayit"],
  [/Openmausbot/g, "Relayit"],
  [/MAUSBOT/g, "RELAYIT"],
  [/MausBot/g, "RelayIt"],
  [/Mausbot/g, "Relayit"],
  [/mausBot/g, "relayIt"],
  [/mausbot/g, "relayit"],
  [/OPENGROKBOT/g, "RELAYIT"],
  [/OpenGrokBot/g, "RelayIt"],
  [/opengrokbot/g, "relayit"],
  [/OPENMAUS/g, "RELAYIT"],
  [/OpenMaus/g, "RelayIt"],
  [/openMaus/g, "relayIt"],
  [/openmaus/g, "relayit"],
];

/** A host or repo address that still names upstream. Word lists can't tell what it should become. */
const UPSTREAM_ADDRESS = /(?:[a-z0-9-]+\.)*(?:openmaus|mausbot|opengrokbot|supamaus)[a-z0-9-]*\.(?:com|si|page|io|dev|net|org|ai|workers\.dev)\b|github\.com\/milind-soni\/[A-Za-z0-9._-]+|(?:[a-z0-9-]+\.)*milindsoni[0-9]*\.workers\.dev/gi;

/** Marked for a person: their name and mascot are trademarks, and these need new words or art, not a swap. */
const NEEDS_A_PERSON = /supamaus|\bmaus\b|\bmauses\b|\bmascot/i;

export function renameText(text) {
  let out = text;
  for (const [from, to] of NAMES) out = out.replace(from, to);
  return out;
}

export function upstreamAddresses(text) {
  return [...new Set(text.match(UPSTREAM_ADDRESS) ?? [])];
}

export function isKept(path) {
  return KEEP.some((rule) => rule.test(path));
}

function main() {
  const apply = process.argv.includes("--apply");
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean);
  const addresses = new Map();
  const review = [];
  const renames = [];
  const writes = [];
  let changed = 0;
  let replaced = 0;

  for (const path of files) {
    if (isKept(path)) continue;
    const renamed = renameText(path);
    if (renamed !== path) renames.push([path, renamed]);
    if (BINARY.test(path)) continue;
    let text;
    try { text = readFileSync(path, "utf8"); } catch { continue; }
    if (text.includes("\0")) continue;
    for (const address of upstreamAddresses(text)) {
      if (!addresses.has(address)) addresses.set(address, []);
      addresses.get(address).push(path);
    }
    if (NEEDS_A_PERSON.test(text) || NEEDS_A_PERSON.test(path)) review.push(path);
    const next = renameText(text);
    if (next === text) continue;
    changed += 1;
    for (const [from] of NAMES) replaced += text.match(from)?.length ?? 0;
    writes.push([path, next]);
  }

  if (addresses.size > 0) {
    console.error(`\n${addresses.size} upstream addresses are still in the tree. Remove them first:`);
    for (const [address, where] of [...addresses].sort(([a], [b]) => a.localeCompare(b))) {
      console.error(`  ${address}  (${where.length} files, e.g. ${where[0]})`);
    }
    console.error(`\nNothing was written. Otherwise this would change ${changed} files (${replaced} mentions) and rename ${renames.length} paths.`);
    process.exitCode = 1;
    return;
  }

  if (apply) {
    for (const [path, next] of writes) writeFileSync(path, next);
    for (const [from, to] of renames) {
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
    }
  }
  console.log(`${apply ? "Changed" : "Would change"} ${changed} files (${replaced} mentions) and ${apply ? "renamed" : "would rename"} ${renames.length} paths.`);
  console.log(`${review.length} files still mention the mascot or its words and need a person or new art:`);
  for (const path of review.slice(0, 40)) console.log(`  ${path}`);
  if (review.length > 40) console.log(`  …and ${review.length - 40} more`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
