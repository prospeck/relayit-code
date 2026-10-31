import type { Page } from "playwright-core";
import { SENSITIVE_PATTERN } from "./policy.ts";

export type PageSnapshot = { title: string; url: string; text: string };
const nextRefs = new WeakMap<Page, number>();

/** New snapshots invalidate old refs so stale actions fail instead of hitting a new control. */
export async function snapshot(page: Page): Promise<PageSnapshot> {
  const result = await page.evaluate(({ start, sensitivePattern }) => {
    const clean = (value: string | null | undefined, cap = 160) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, cap);
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      }
      return rect.width > 0 && rect.height > 0 && rect.bottom > -innerHeight && rect.top < innerHeight * 2
        && rect.right > 0 && rect.left < innerWidth && !element.closest('[hidden], [inert], [aria-hidden="true"]');
    };
    const name = (element: Element) => {
      const labelled = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean)
        .map(id => document.getElementById(id)?.textContent ?? "").join(" ");
      const labels = "labels" in element ? Array.from((element as HTMLInputElement).labels ?? []).map(label => label.textContent).join(" ") : "";
      const editable = ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) || element.hasAttribute("contenteditable")
        || ["textbox", "searchbox", "combobox"].includes(element.getAttribute("role") ?? "");
      return clean(element.getAttribute("aria-label") || labelled || labels || (!editable ? (element as HTMLElement).innerText : "")
        || element.getAttribute("placeholder") || element.getAttribute("title") || element.getAttribute("alt") || element.getAttribute("name"));
    };
    document.querySelectorAll("[data-relayit-ref]").forEach(element => element.removeAttribute("data-relayit-ref"));
    let next = start;
    const lines: string[] = [];
    const controls = document.querySelectorAll('a[href],button,input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[role="tab"],[role="textbox"],[role="searchbox"],[role="combobox"],[role="checkbox"],[role="radio"],[contenteditable="true"],[tabindex]');
    for (const element of controls) {
      if (!visible(element)) continue;
      const ref = String(next++);
      element.setAttribute("data-relayit-ref", ref);
      const tag = element.tagName.toLowerCase();
      const type = element.getAttribute("type")?.toLowerCase();
      const role = element.getAttribute("role") || (tag === "a" ? "link" : tag === "select" ? "combobox"
        : tag === "textarea" || tag === "input" && !["button", "submit", "reset", "checkbox", "radio"].includes(type ?? "") ? "textbox"
        : type === "checkbox" || type === "radio" ? type : element.hasAttribute("contenteditable") ? "textbox" : "button");
      const sensitive = ["type", "name", "id", "autocomplete", "aria-label", "placeholder"].some(attr => new RegExp(sensitivePattern, "i").test(element.getAttribute(attr) ?? ""));
      const value = "value" in element ? clean(String(element.value), 100) : null;
      const suffix = sensitive ? " (sensitive — user must fill)" : value !== null ? ` (value: ${JSON.stringify(value)})` : "";
      const href = tag === "a" ? ` → ${clean(element.getAttribute("href"), 160)}` : "";
      lines.push(`[${ref}] ${role} ${JSON.stringify(name(element))}${suffix}${href}`);
    }
    const seen = new Set<string>();
    const blocks: string[] = [];
    for (const element of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,dt,dd,label,[role="heading"],div,span')) {
      if (!visible(element) || element.closest("[data-relayit-ref]") || element.querySelector("[data-relayit-ref]")) continue;
      if (element.children.length && !/^H[1-6]$/.test(element.tagName) && !["P", "LI", "LABEL"].includes(element.tagName)) continue;
      const text = clean((element as HTMLElement).innerText, 300);
      if (text && !seen.has(text)) { seen.add(text); blocks.push(/^H[1-6]$/.test(element.tagName) ? `Heading: ${text}` : text); }
    }
    return { title: clean(document.title, 250), url: location.href.slice(0, 1000), lines, blocks, next };
  }, { start: nextRefs.get(page) ?? 1, sensitivePattern: SENSITIVE_PATTERN });
  nextRefs.set(page, result.next);
  return { title: result.title, url: result.url,
    text: [`Title: ${result.title}`, `URL: ${result.url}`, ...result.lines, ...result.blocks].join("\n").slice(0, 6000) };
}
