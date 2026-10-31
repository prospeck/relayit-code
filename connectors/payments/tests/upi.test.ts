import { describe, expect, it } from "vitest";
import { buildUpiUri, parseUpiUri } from "../src/upi.ts";
import { upiQrSvg } from "../src/qr.ts";

const request = {
  vpa: "asha.shop-1@okaxis",
  payeeName: "आशा & Sons + Co",
  amountInr: 1234.5,
  note: "Lunch & tea + delivery? #1 / 50%",
  txnRef: "order/one?x=1&y=2",
  merchantCode: "5411",
};

describe("UPI", () => {
  it("encodes every value and round-trips Unicode and reserved characters", () => {
    const uri = buildUpiUri(request);
    expect(uri).toContain("upi://pay?pa=asha.shop-1%40okaxis");
    expect(uri).toContain("&am=1234.50&cu=INR&");
    expect(uri).toContain("%20%26%20");
    expect(uri).toContain("%2B");
    expect(uri).toContain("&mc=5411");
    expect(parseUpiUri(uri)).toEqual(request);
  });

  it("omits an absent merchant code and always has two decimal places", () => {
    const { merchantCode: _merchantCode, ...withoutCode } = request;
    const uri = buildUpiUri({ ...withoutCode, amountInr: 1 });
    expect(uri).toContain("am=1.00");
    expect(uri).not.toContain("mc=");
    expect(parseUpiUri(uri)).toEqual({ ...withoutCode, amountInr: 1 });
  });

  it.each(["", "missing", "@bank", "a@", "a@@bank", "a b@bank", "a@bank/path"])("rejects invalid VPA %j", (vpa) => {
    expect(() => buildUpiUri({ ...request, vpa })).toThrow("VPA");
  });

  it.each([0, -1, 100_000.01, NaN, Infinity, -Infinity, 0.001, 1.234])("rejects invalid amount %s", (amountInr) => {
    expect(() => buildUpiUri({ ...request, amountInr })).toThrow("Amount");
  });

  it.each([0.01, 0.29, 100_000])("accepts valid amount %s", (amountInr) => {
    expect(parseUpiUri(buildUpiUri({ ...request, amountInr })).amountInr).toBe(amountInr);
  });

  it("limits notes to 80 Unicode characters", () => {
    expect(() => buildUpiUri({ ...request, note: "x".repeat(81) })).toThrow("80");
    expect(parseUpiUri(buildUpiUri({ ...request, note: "🌾".repeat(80) })).note).toBe("🌾".repeat(80));
  });

  it.each(["https://pay?pa=a@b", "upi://collect", "upi://pay/path", "upi://pay?cu=USD", "upi://pay?cu=INR"])("rejects invalid URI %s", (uri) => {
    expect(() => parseUpiUri(uri)).toThrow();
  });

  it("rejects missing payee names and transaction references", () => {
    expect(() => buildUpiUri({ ...request, payeeName: " " })).toThrow("Payee");
    expect(() => buildUpiUri({ ...request, txnRef: " " })).toThrow("reference");
  });
});

describe("QR", () => {
  it("produces a scalable SVG with a viewBox and no fixed dimensions", async () => {
    const svg = await upiQrSvg(buildUpiUri(request));
    expect(svg).toMatch(/^<svg\b/);
    expect(svg).toContain("viewBox=");
    expect(svg).not.toMatch(/\s(?:width|height)=/);
    expect(svg).toContain("<path");
  });

  it("supports custom foreground and background colours", async () => {
    const svg = await upiQrSvg(buildUpiUri(request), { dark: "#123456", light: "#fedcba" });
    expect(svg).toContain("#123456");
    expect(svg).toContain("#fedcba");
  });
});
