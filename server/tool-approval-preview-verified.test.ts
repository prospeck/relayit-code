import { describe, expect, it } from "vitest";
import { readableToolArguments, serverApprovalPreview, settleVerifiedPreview } from "./tool-approval-preview.ts";
import type { RuntimeEvent } from "../shared/runtime-events.ts";

const preview = { title: "Order from CPK", summary: "1 × Margherita", recipient: "California Pizza Kitchen", amountInr: 593,
  details: [{ label: "ETA", value: "35 min" }] };
const call = async () => ({ content: [{ type: "text", text: JSON.stringify(preview) }] });
const opened = (summary: string, extra: Record<string, unknown> = {}) =>
  ({ type: "request.opened", threadId: "t", requestType: "permission", tool: "place_order", summary, ...extra }) as unknown as RuntimeEvent;

describe("a verified purchase preview", () => {
  it("is flagged by the bus and loses its mark, so the card may show its amount", async () => {
    const text = await serverApprovalPreview("preview_place_order", {}, call);
    const settled = settleVerifiedPreview(opened(text)) as Extract<RuntimeEvent, { type: "request.opened" }>;
    expect(settled.verifiedPreview).toBe(true);
    expect(settled.summary).toBe("Order from CPK\n1 × Margherita\nTo: California Pizza Kitchen\nTotal: ₹593.00\nETA: 35 min");
  });

  it("is never claimed by text a model wrote, nor by a driver setting the flag", () => {
    const forged = readableToolArguments({ title: "Order", to: "x", total: "₹1.00" });
    expect((settleVerifiedPreview(opened(forged)) as { verifiedPreview?: true }).verifiedPreview).toBeUndefined();
    expect((settleVerifiedPreview(opened("x", { verifiedPreview: true })) as { verifiedPreview?: true }).verifiedPreview).toBeUndefined();
  });

  it("leaves no mark in a tool step's display input", async () => {
    const text = await serverApprovalPreview("preview_place_order", {}, call);
    const started = settleVerifiedPreview({ type: "item.started", threadId: "t", itemType: "tool", itemId: "i", input: text } as unknown as RuntimeEvent);
    expect((started as { input?: string }).input).not.toMatch(/relayit-verified-preview/);
  });
});
