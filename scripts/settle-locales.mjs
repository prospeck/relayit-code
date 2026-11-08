// After English changes: a translation written against older English falls back to English (it is removed), except the
// languages listed as rewritten alongside it, whose hashes move to today's English. Run, then `pnpm i18n:check`.
//   node scripts/settle-locales.mjs hi
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceHash } from "./generate-locale.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "locales");
const rewritten = new Set(process.argv.slice(2));
const read = (file) => JSON.parse(readFileSync(join(dir, file), "utf8"));
const write = (file, value) => writeFileSync(join(dir, file), JSON.stringify(value, null, 2) + "\n");
const en = read("en.json");
const hashes = read("source-hashes.json");
let removed = 0, moved = 0;
for (const [code, recorded] of Object.entries(hashes.locales)) {
  const file = `${code}.json`;
  const catalog = read(file);
  for (const [key, hash] of Object.entries(recorded)) {
    if (!Object.hasOwn(en, key) || hash === sourceHash(en[key])) continue;
    if (rewritten.has(code) && Object.hasOwn(catalog, key)) { recorded[key] = sourceHash(en[key]); moved += 1; continue; }
    delete catalog[key];
    delete recorded[key];
    removed += 1;
  }
  write(file, catalog);
}
write("source-hashes.json", hashes);
console.log(`settled: ${removed} stale translations now fall back to English, ${moved} rewritten hashes moved`);
