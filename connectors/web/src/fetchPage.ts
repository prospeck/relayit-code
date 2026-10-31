import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_BYTES = 2 * 1024 * 1024;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function privateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0))
      || (a === 198 && (b === 18 || b === 19));
  }
  if (isIP(address) === 6) {
    // URL canonicalization turns IPv4-mapped IPv6 into hexadecimal groups.
    const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/i.exec(address);
    if (mapped) {
      const high = parseInt(mapped[1]!, 16), low = parseInt(mapped[2]!, 16);
      return privateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (dotted) return privateAddress(dotted[1]!);
    // Only global unicast space; excludes loopback, ULA, link-local and multicast.
    return !/^[23][\da-f]{3}:/i.test(address) || /^2001:db8:/i.test(address);
  }
  return true;
}

async function checkUrl(url: URL, allowPrivate: boolean): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https pages are supported.");
  if (url.username || url.password) throw new Error("Page URLs must not contain credentials.");
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) throw new Error("Private or local page addresses are not allowed.");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) {
    throw new Error("Private or local page addresses are not allowed.");
  }
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", copy: "©",
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (!entity.startsWith("#")) return named[entity.toLowerCase()] ?? match;
    const point = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "�";
  });
}

function plainText(html: string): string {
  return decodeEntities(html
    .replace(/<\/?(?:h[1-6]|p|div|section|article|main|li|ul|ol|blockquote|pre|tr)\b[^>]*>|<br\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, ""))
    .split(/\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

function dropElements(html: string): string {
  const discarded = new Set(["script", "style", "nav", "footer", "header", "aside", "form", "noscript", "svg", "head"]);
  const stack: string[] = [];
  let result = "", offset = 0;
  const tags = /<\/?([a-z][\w:-]*)\b[^>]*>/gi;
  for (const match of html.matchAll(tags)) {
    if (!stack.length) result += html.slice(offset, match.index);
    const tag = match[1]!.toLowerCase();
    const closing = match[0].startsWith("</");
    if (stack.length) {
      if (closing) {
        const index = stack.lastIndexOf(tag);
        if (index >= 0) stack.length = index;
      } else if (discarded.has(tag) && !match[0].endsWith("/>")) stack.push(tag);
    } else if (discarded.has(tag)) {
      if (!closing && !match[0].endsWith("/>")) stack.push(tag);
    } else result += match[0];
    offset = match.index + match[0].length;
  }
  if (!stack.length) result += html.slice(offset);
  return result;
}

export function extractReadable(html: string): { title: string; text: string } {
  const title = plainText(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? "");
  // Raw text elements may contain strings resembling HTML tags.
  let content = dropElements(html.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ""));
  content = /<article\b[^>]*>([\s\S]*?)<\/article\s*>/i.exec(content)?.[1]
    ?? /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(content)?.[1] ?? content;
  return { title, text: plainText(content) };
}

export type ReadablePage = { url: string; title: string; text: string; truncated: boolean };

export async function fetchReadable(url: string, {
  fetch = globalThis.fetch, maxChars = 12_000, timeoutMs = 15_000, allowPrivate = false,
}: {
  fetch?: typeof globalThis.fetch; maxChars?: number; timeoutMs?: number;
  /** For offline tests only. Never enable for user-supplied URLs. */
  allowPrivate?: boolean;
} = {}): Promise<ReadablePage> {
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error("maxChars must be a positive integer.");
  const signal = AbortSignal.timeout(timeoutMs);
  let current = new URL(url);
  for (let hop = 0; hop <= 5; hop++) {
    let onAbort: () => void = () => {};
    try {
      await Promise.race([
        checkUrl(current, allowPrivate),
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(signal.reason);
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
        }),
      ]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    signal.throwIfAborted();
    const response = await fetch(current.href, { redirect: "manual", signal });
    if (REDIRECTS.has(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("Page redirect has no destination.");
      if (hop === 5) throw new Error("Page exceeded the limit of 5 redirects.");
      current = new URL(location, current);
      continue;
    }
    try {
      if (!response.ok) throw new Error(`Page request failed (HTTP ${response.status}).`);
      const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (type !== "text/html" && type !== "text/plain") throw new Error("Only text/html and text/plain pages are supported.");
      if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Page exceeds the 2 MB download limit.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) throw new Error("Page exceeds the 2 MB download limit.");
            chunks.push(value);
          }
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
      }
      const body = Buffer.concat(chunks).toString("utf8");
      const { title, text } = type === "text/html" ? extractReadable(body) : { title: "", text: body.trim() };
      return { url: current.href, title: title || current.hostname, text: text.slice(0, maxChars), truncated: text.length > maxChars };
    } finally {
      if (!response.body?.locked) await response.body?.cancel();
    }
  }
  throw new Error("Page exceeded the limit of 5 redirects.");
}
