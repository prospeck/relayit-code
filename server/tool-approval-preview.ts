import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { RuntimeEvent } from "../shared/runtime-events.ts";
import { toolDetailPreview } from "./tool-summary.ts";

export const PREVIEW_UNAVAILABLE = "The approval card can't be shown because its server preview failed. The action was refused and was not executed. Do not retry it.";

export class ToolApprovalPreviewError extends Error {
  constructor() { super(PREVIEW_UNAVAILABLE); }
}

const previewSchema = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  recipient: z.string().trim().min(1),
  amountInr: z.number().finite().nonnegative(),
  details: z.array(z.object({ label: z.string().min(1), value: z.string().min(1) })).min(1),
});

/** Leads a preview a shipped connector wrote, so the card can show its amount as fact. Random per process and stripped
 * in the event bus before anything stores, shows or forwards the event: no model, tool argument or client ever holds
 * it, so no text they write can pass for a verified preview. */
const VERIFIED_MARK = `relayit-verified-preview:${randomBytes(16).toString("hex")}\n`;

/** request.opened gains `verifiedPreview` only from a preview this process marked; the mark leaves every event. */
export function settleVerifiedPreview(event: RuntimeEvent): RuntimeEvent {
  if (event.type === "request.opened") {
    const { verifiedPreview: _claimed, ...rest } = event;
    return event.summary.startsWith(VERIFIED_MARK)
      ? { ...rest, summary: event.summary.slice(VERIFIED_MARK.length), verifiedPreview: true }
      : rest;
  }
  if (event.type === "item.started" && typeof event.input === "string" && event.input.startsWith(VERIFIED_MARK)) {
    return { ...event, input: event.input.slice(VERIFIED_MARK.length) };
  }
  return event;
}

/** Only a shipped connector's declared preview may supply purchase facts. No model input is merged into it. */
export async function serverApprovalPreview(
  declaration: unknown,
  args: Record<string, unknown>,
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): Promise<string> {
  try {
    if (typeof declaration !== "string" || !declaration.trim()) throw new Error();
    const result = await call(declaration, args) as { isError?: unknown; content?: Array<{ type?: string; text?: string }> };
    if (result.isError || !Array.isArray(result.content)) throw new Error();
    const text = result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    const preview = previewSchema.parse(JSON.parse(text));
    const amount = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(preview.amountInr);
    return VERIFIED_MARK + toolDetailPreview(`${preview.title}\n${preview.summary}\nTo: ${preview.recipient}\nTotal: ${amount}\n${preview.details.map((detail) => `${detail.label}: ${detail.value}`).join("\n")}`)!;
  } catch {
    throw new ToolApprovalPreviewError();
  }
}

/** Untrusted servers keep argument-based cards, with explicit labels and secret redaction. */
export function readableToolArguments(input: Record<string, unknown>): string {
  const safe = toolDetailPreview(input);
  if (!safe) return "This tool has no arguments.";
  let value: unknown;
  try { value = JSON.parse(safe); }
  catch {
    return Object.entries(input).slice(0, 40).map(([key, child]) => {
      const field = toolDetailPreview({ [key]: child });
      try { return readableToolArguments(JSON.parse(field ?? "{}")); }
      catch { return `${key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ")}: [Large value omitted; review the tool input.]`; }
    }).join("\n");
  }
  const lines = (item: unknown, prefix = "", depth = 0): string[] => {
    if (item === null || typeof item !== "object" || depth > 6) return [`${prefix}: ${String(item)}`];
    return Object.entries(item).flatMap(([key, child]) => {
      const label = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
      return lines(child, prefix ? `${prefix} · ${label}` : label.charAt(0).toUpperCase() + label.slice(1), depth + 1);
    });
  };
  return lines(value).join("\n");
}
