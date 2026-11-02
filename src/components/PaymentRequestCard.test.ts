import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildUpiUri } from "../../connectors/payments/src/upi";
import { paymentRequest } from "@/lib/payment-request";
import { PaymentRequestCard } from "./PaymentRequestCard";
import { setLocale } from "@/lib/i18n";

const name = "mcp__india-payments__payments_create_request";
const input = { vpa: "asha@bank", payeeName: "Asha", amountInr: 450, note: "Lunch", txnRef: "fixture" };
const card = { type: "payment", id: "p", orderId: "o", payeeName: input.payeeName, payeeVpa: input.vpa, amountInr: input.amountInr, upiUri: buildUpiUri(input), checkoutUrl: null, status: "pending" };
const render = (data: unknown, ok = true) => renderToStaticMarkup(createElement(PaymentRequestCard, { name, output: JSON.stringify(data), ok }));

describe("UPI chat card", () => {
  it("renders its own QR and handoff from a validated MCP result without embedding tool HTML", () => {
    const html = render({ content: [{ type: "text", text: JSON.stringify(card) }] });
    expect(html).toContain("<svg");
    expect(html).toContain("₹450.00");
    expect(html).toContain("Open UPI app");
    expect(html).toContain("does not verify payment");
    expect(render({ ...card, qrSvg: "<script>bad()</script>" })).not.toContain("<script>");
    expect(render(card, false)).toBe("");
  });
  it.each(["payments_create_request", "india_payments_payments_create_request", "india-payments__payments_create_request", "mcp__india-payments__payments_create_request"])("accepts the native driver projection %s", (toolName) => {
    expect(paymentRequest(toolName, JSON.stringify({ ok: true, result: card }))).toMatchObject({ id: card.id });
    expect(paymentRequest(toolName, JSON.stringify([{ type: "content", content: { type: "text", text: JSON.stringify(card) } }]))).toMatchObject({ id: card.id });
    expect(paymentRequest(toolName, JSON.stringify({ ok: false, result: card }))).toBeNull();
  });
  it("refuses mismatched amounts, non-payment tools and unsafe checkout links", () => {
    expect(render({ ...card, upiUri: card.upiUri + "&pa=other%40bank" })).toBe("");
    expect(render({ ...card, amountInr: 999 })).toBe("");
    expect(render({ ...card, payeeVpa: "other@bank" })).toBe("");
    expect(render({ ...card, checkoutUrl: "javascript:alert(1)" })).toBe("");
    expect(render({ ...card, checkoutUrl: "https://attacker.example/pay" })).toBe("");
    expect(paymentRequest("mcp__web__read", JSON.stringify(card))).toBeNull();
  });
  it("hides payable QR codes for demos and settled requests", () => {
    expect(render({ ...card, demo: true })).toContain("no real payment");
    expect(render({ ...card, demo: true })).not.toContain("<svg");
    expect(render({ ...card, status: "user_confirmed" })).not.toContain("<svg");
    const mock = render({ ...card, demo: true, checkoutUrl: "http://127.0.0.1:1234/pay/mock" });
    expect(mock).toContain("<svg");
    expect(mock).not.toContain("Open UPI app");
    expect(mock).toContain("no real payment");
  });
  it("uses English fallback when a translated pack lacks the new strings", () => {
    try { setLocale("hi"); expect(render(card)).toContain("Pay in your UPI app"); }
    finally { setLocale("en"); }
  });

  it("takes a demo payment with no UPI link, and refuses a real one without it", () => {
    const checkoutUrl = "http://127.0.0.1:9999/pay/x";
    expect(paymentRequest("payments_create_request", JSON.stringify({ ...card, upiUri: null, demo: true, checkoutUrl }))).toMatchObject({ upiUri: null, demo: true });
    expect(paymentRequest("payments_create_request", JSON.stringify({ ...card, upiUri: null, demo: false, checkoutUrl }))).toBeNull();
    expect(paymentRequest("payments_create_request", JSON.stringify({ ...card, upiUri: null }))).toBeNull();
  });
});
