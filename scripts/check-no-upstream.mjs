import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOTS = ["server", "src", "shared", "electron", "companion", "connector", "public", "package.json", "electron-builder.yml"];
const LEGAL_FILES = new Set(["LICENSE", "NOTICE", "UPSTREAM.md"]);
const UPSTREAM = /(?<![a-z0-9_-])(?:openmausbot\.com(?![a-z0-9_-])|mausbot\.(?:si|page|com)(?![a-z0-9_-])|c-opaque\.(?:openmausbot\.com|mausbot\.si)|openmausbot-composio\.milindsoni201\.workers\.dev|omb-(?:cloud-staging|[uct]-[a-z0-9-]+)\.fly\.dev|(?:api\.)?botdirectory\.ai|us\.i\.posthog\.com|(?:github\.com|(?:raw\.)?githubusercontent\.com|ghcr\.io)\/(?:repos\/)?milind-soni\/[^\s"'`<>)}\]]+|cal\.com\/milind-soni[^\s"'`<>)}\]]*|discord\.gg\/9Wb8MEpXRs|producthunt\.com\/products\/mausbot|apps\.apple\.com\/[^\s"'`<>)}\]]*id6803387923)/gi;

export function upstreamReferences(source) {
  const normalized = source.replace(/\\+\./g, ".").replaceAll("[.]", ".").replaceAll("\\/", "/");
  return normalized.split(/\r?\n/).flatMap((line, index) => [...line.matchAll(UPSTREAM)].map(match => ({ line: index + 1, match: match[0] })));
}

export async function checkNoUpstream(root) {
  const hits = [];
  let scanned = 0;
  async function visit(relative) {
    if (relative.split(path.sep).includes("third_party") || LEGAL_FILES.has(path.basename(relative))) return;
    const absolute = path.join(root, relative);
    let entries;
    try { entries = await readdir(absolute, { withFileTypes: true }); }
    catch (error) {
      if (error.code === "ENOENT") return;
      if (error.code !== "ENOTDIR") throw error;
    }
    if (entries) {
      for (const entry of entries) if (!entry.isSymbolicLink()) await visit(path.join(relative, entry.name));
      return;
    }
    const bytes = await readFile(absolute);
    if (bytes.includes(0)) return;
    scanned++;
    for (const hit of upstreamReferences(bytes.toString("utf8"))) hits.push({ file: relative, ...hit });
  }
  for (const relative of ROOTS) await visit(relative);
  return { hits, scanned };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { hits, scanned } = await checkNoUpstream(root);
  for (const hit of hits) console.error(`${hit.file}:${hit.line}: ${hit.match}`);
  if (hits.length) {
    console.error(`check-no-upstream: FAIL (${hits.length} references in ${scanned} files)`);
    process.exitCode = 1;
  } else console.log(`check-no-upstream: PASS (${scanned} files scanned)`);
}
