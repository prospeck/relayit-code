import { z } from "zod";
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
    return toolDetailPreview(`${preview.title}\n${preview.summary}\nTotal: ${amount}\n${preview.details.map((detail) => `${detail.label}: ${detail.value}`).join("\n")}`)!;
  } catch {
    throw new ToolApprovalPreviewError();
  }
}

/** Untrusted servers keep argument-based cards, with explicit labels and secret redaction. */
export function readableToolArguments(input: Record<string, unknown>): string {
  const safe = toolDetailPreview(input);
  if (!safe) return "This tool has no arguments.";
  let value: unknown;
  try { value = JSON.parse(safe); } catch { return safe; }
  const lines = (item: unknown, prefix = "", depth = 0): string[] => {
    if (item === null || typeof item !== "object" || depth > 6) return [`${prefix}: ${String(item)}`];
    return Object.entries(item).flatMap(([key, child]) => {
      const label = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
      return lines(child, prefix ? `${prefix} · ${label}` : label.charAt(0).toUpperCase() + label.slice(1), depth + 1);
    });
  };
  return lines(value).join("\n");
}
