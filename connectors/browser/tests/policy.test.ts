import { describe, expect, it } from "vitest";
import { createBrowserTools, recipeFor, serviceFor } from "../src/index.ts";
import { isCommit, isPaymentStep, isSensitiveField, validateUrl } from "../src/policy.ts";

describe("browser policy without Chromium", () => {
  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "chrome://settings",
    "data:text/html,test",
    "ftp://example.com",
    "bad url",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => validateUrl(url)).toThrow(/http/i);
  });
  it("allows http and https", () => {
    expect(validateUrl("https://example.com")).toBe("https://example.com/");
    expect(validateUrl("http://localhost:1234/shop")).toBe("http://localhost:1234/shop");
  });
  it.each([
    { type: "password" },
    { name: "customerOTP" },
    { id: "upiPin" },
    { autocomplete: "one-time-code" },
    { autocomplete: "cc-number" },
    { autocomplete: "cc-csc" },
    { ariaLabel: "Card number" },
    { placeholder: "Enter CVV" },
    { name: "payment_pin" },
    { id: "passwordField" },
  ])("detects sensitive field metadata %j", (field) => expect(isSensitiveField(field)).toBe(true));
  it("allows restaurant search text", () =>
    expect(isSensitiveField({ type: "search", placeholder: "Search restaurants" })).toBe(false));
  it("does not mistake shipping address fields for PIN fields", () => {
    expect(isSensitiveField({ name: "shippingAddress", id: "shopping-notes" })).toBe(false);
  });
  it("checks field metadata without treating ordinary button captions as sensitive inputs", () => {
    const control = { type: "button", text: "Shopping cart", submit: false };
    expect(isSensitiveField(control)).toBe(false);
  });
  it.each([
    "Place order",
    "PAY",
    "Proceed to Pay",
    "Checkout",
    "Confirm",
    "Book",
    "Buy now",
    "Send message",
    "Post",
    "Delete",
    "Submit",
    "Request ride",
    "Continue to payment",
  ])("requires approval for %s", (text) => {
    expect(isCommit({ text, submit: false })).toBe(true);
  });
  it("recognises a form submit regardless of label, and allows cart preparation", () => {
    expect(isCommit({ text: "Continue", submit: true })).toBe(true);
    for (const text of [
      "ADD",
      "Add to cart",
      "+",
      "Filters",
      "Facebook",
      "Bookmarked restaurants",
    ]) {
      expect(isCommit({ text, submit: false })).toBe(false);
    }
  });
  it.each([
    "https://api.razorpay.com/checkout",
    "https://secure.payu.in",
    "https://juspay.in/pay",
    "https://paytm.com/checkout",
    "https://phonepe.com/checkout",
    "https://shop.test/payment",
  ])("hands off payment URL %s", (url) => {
    expect(isPaymentStep(url, "")).toBe(true);
  });
  it("detects payment text without treating a cart total as the payment page", () => {
    expect(isPaymentStep("https://shop.test/step", "Choose UPI or netbanking")).toBe(true);
    expect(isPaymentStep("https://shop.test/step", "cardNumber cc-number")).toBe(true);
    expect(isPaymentStep("https://shop.test/cart", "Total ₹120 Proceed to Pay")).toBe(false);
    expect(isPaymentStep("https://notrazorpay.com/cart", "Your cart")).toBe(false);
  });
  it.each([
    ["https://www.swiggy.com/search", "Swiggy"],
    ["https://zomato.com", "Zomato"],
    ["https://www.zeptonow.com", "Zepto"],
    ["https://blinkit.com", "Blinkit"],
    ["https://justswish.in", "Swish"],
    ["https://m.uber.com", "Uber"],
  ])("finds best-effort recipe for %s", (url, name) => {
    expect(recipeFor(url)?.name).toBe(name);
    expect(recipeFor(url)?.playbook).toContain("best-effort");
  });
  it("matches hostname boundaries and derives service names", () => {
    expect(recipeFor("https://swiggy.com.evil.test")).toBeUndefined();
    expect(recipeFor("invalid")).toBeUndefined();
    expect(serviceFor("https://www.irctc.co.in")).toBe("IRCTC");
    expect(serviceFor("https://shop.example")).toBe("shop.example");
  });
  it("keeps every tool output untrusted and submit as the only act tool", async () => {
    const tools = createBrowserTools({
      getSession: async () => {
        throw new Error("must not launch");
      },
      isEnabled: async () => false,
    });
    expect(tools).toHaveLength(10);
    expect(tools.every((tool) => tool.domain === "browser" && tool.untrustedOutput)).toBe(true);
    expect(tools.filter((tool) => tool.toolClass === "act").map((tool) => tool.name)).toEqual([
      "browser_submit",
    ]);
    const open = tools.find((tool) => tool.name === "browser_open")!;
    await expect(open.run({ url: "https://example.com" }, {} as never)).rejects.toThrow(
      /disabled/i,
    );
    for (const url of ["file:///tmp/test", "chrome://settings", "javascript:alert(1)"]) {
      expect(open.input.safeParse({ url }).success).toBe(false);
    }
  });
});
