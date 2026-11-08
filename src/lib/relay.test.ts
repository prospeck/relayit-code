import { describe, expect, it } from "vitest";
import type { Message, Task } from "@/state/store";
import { amountParts, dateLocale, dayPart, firstName, moneyPreview, relayLeg, relayStatus, relaysOf } from "./relay";

const task = (fields: Partial<Task>): Task => ({ threadId: "t", title: "T", createdAt: 1, ...fields });
const msg = (fields: Partial<Message>): Message => ({ id: Math.random().toString(36), at: 1, role: "bot", kind: "text", ...fields }) as Message;
const ORDER = "Order from California Pizza Kitchen\n1 × Margherita from California Pizza Kitchen.\nTo: California Pizza Kitchen\nTotal: ₹593.00\nItems: 1 × Margherita\nETA: 35 min";

describe("a relay's status", () => {
  it("waits on you first, then runs, and is otherwise done", () => {
    expect(relayStatus(task({ activity: "waiting-on-you", busy: true }))).toBe("yours");
    expect(relayStatus(task({ openAsks: 1 }))).toBe("yours");
    expect(relayStatus(task({ busy: true }))).toBe("running");
    expect(relayStatus(task({ activity: "working" }))).toBe("running");
    expect(relayStatus(task({ activity: "idle" }))).toBe("done");
  });

  it("lists relays newest first, leaving out archived, snoozed, routine and untouched threads", () => {
    const now = 10_000;
    const list = relaysOf([
      task({ threadId: "old", lastThreadOrderAt: 100 }),
      task({ threadId: "new", lastThreadOrderAt: 900 }),
      task({ threadId: "empty" }),
      task({ threadId: "starting", busy: true, createdAt: 950 }),
      task({ threadId: "archived", lastThreadOrderAt: 999, archivedAt: 1 }),
      task({ threadId: "snoozed", lastThreadOrderAt: 999, snoozedUntil: now + 1 }),
      task({ threadId: "routine", lastThreadOrderAt: 999, routineRunId: "r" }),
    ], now);
    expect(list.map((item) => item.threadId)).toEqual(["starting", "new", "old"]);
  });
});

describe("the money card", () => {
  it("reads a verified preview into title, recipient, total and details", () => {
    expect(moneyPreview({ verifiedPreview: true, subtitle: ORDER })).toEqual({
      title: "Order from California Pizza Kitchen",
      summary: "1 × Margherita from California Pizza Kitchen.",
      to: "California Pizza Kitchen",
      total: "₹593.00",
      details: [{ label: "Items", value: "1 × Margherita" }, { label: "ETA", value: "35 min" }],
    });
  });

  it("never treats unverified text as an amount, however it is shaped", () => {
    expect(moneyPreview({ subtitle: ORDER })).toBeNull();
    expect(moneyPreview({ verifiedPreview: true, subtitle: "Order\nSummary\nTotal: ₹1.00\nTo: x" })).toBeNull();
    expect(moneyPreview(undefined)).toBeNull();
  });

  it("splits the amount for type, dropping zero paise", () => {
    expect(amountParts("₹593.00")).toEqual({ symbol: "₹", whole: "593", fraction: "" });
    expect(amountParts("₹1,24,599.50")).toEqual({ symbol: "₹", whole: "1,24,599", fraction: ".50" });
  });
});

describe("a relay's legs", () => {
  const asked = msg({ role: "user", text: "Order something" });
  it("finds, prepares, waits for your OK, and is done", () => {
    expect(relayLeg([], { waiting: false, running: false })).toBe("find");
    expect(relayLeg([asked, msg({ kind: "activity", tool: { name: "search_restaurants" } })], { waiting: false, running: true })).toBe("find");
    expect(relayLeg([asked, msg({ kind: "activity", tool: { name: "prepare_order" } })], { waiting: false, running: true })).toBe("prepare");
    expect(relayLeg([asked], { waiting: true, running: true })).toBe("ok");
    expect(relayLeg([asked, msg({ text: "Placed." })], { waiting: false, running: false })).toBe("done");
  });

  it("counts only what happened since the latest request", () => {
    const earlier = [asked, msg({ kind: "activity", tool: { name: "prepare_order" } }), msg({ role: "user", text: "And a drink" })];
    expect(relayLeg(earlier, { waiting: false, running: true })).toBe("find");
  });
});

describe("words around a relay", () => {
  it("greets by the part of the day and the first name", () => {
    expect(dayPart(new Date(2026, 10, 8, 7))).toBe("morning");
    expect(dayPart(new Date(2026, 10, 8, 13))).toBe("afternoon");
    expect(dayPart(new Date(2026, 10, 8, 19))).toBe("evening");
    expect(dayPart(new Date(2026, 10, 8, 2))).toBe("night");
    expect(firstName("  Taran B Adithya ")).toBe("Taran");
    expect(firstName(undefined)).toBe("");
  });

  it("writes English dates the Indian way", () => {
    expect(dateLocale("en")).toBe("en-IN");
    expect(dateLocale("hi")).toBe("hi");
  });
});
