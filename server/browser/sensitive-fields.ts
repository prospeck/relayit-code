import { callOnNode, valueInWorld } from "./cdp/evaluate.ts";
import { DriverError } from "./cdp/errors.ts";
import type { CdpPage } from "./cdp/page.ts";
import { resolveElement } from "./cdp/selectors.ts";
import { isSensitiveInput } from "./cdp/sensitive.ts";

export const SENSITIVE_FIELD_REFUSAL = "RelayIt cannot type passwords, OTPs, card details, CVV or UPI PINs. Ask the person to enter these themselves in the visible browser, then take a fresh snapshot.";

type Metadata = { type: string; hints: Array<string | null> };
const METADATA = `function () {
  return { type: this.type || "", hints: [this.name, this.id, this.autocomplete,
    this.getAttribute?.("aria-label"), this.getAttribute?.("placeholder"),
    ...Array.from(this.labels || [], label => label.textContent),
    ...(this.getAttribute?.("aria-labelledby") || "").split(/\\s+/).map(id => this.ownerDocument.getElementById(id)?.textContent)] };
}`;
const FOCUSED = `(() => {
  let field = document.activeElement;
  while (field?.shadowRoot?.activeElement) field = field.shadowRoot.activeElement;
  if (!field || field === document.body || field === document.documentElement) return null;
  if (field.localName.includes("-")) return { type: "password", hints: [] };
  return (${METADATA}).call(field);
})()`;
const ALL_FIELDS = `(() => {
  const fields = [];
  const visit = root => {
    for (const field of root.querySelectorAll("input, textarea, [contenteditable]")) fields.push((${METADATA}).call(field));
    for (const element of root.querySelectorAll("*")) if (element.shadowRoot) visit(element.shadowRoot);
  };
  visit(document); return fields;
})()`;

export async function refuseSensitiveTyping(page: CdpPage, target: { ref: string } | { selector: string } | null): Promise<void> {
  const fields = target
    ? [await callOnNode<Metadata>(page.frames, await resolveElement(page.frames, page.refs, target), METADATA)]
    : await Promise.all(page.frames.all().map((frame) => valueInWorld<Metadata | null>(page.frames, frame.id, FOCUSED)));
  if (fields.some((field) => field && isSensitiveInput(field.type, field.hints))) throw new DriverError("refused", SENSITIVE_FIELD_REFUSAL);
}

export async function hasSensitiveFields(page: CdpPage): Promise<boolean> {
  for (const frame of page.frames.all()) {
    const fields = await valueInWorld<Metadata[]>(page.frames, frame.id, ALL_FIELDS);
    if (fields.some((field) => isSensitiveInput(field.type, field.hints))) return true;
  }
  return false;
}
