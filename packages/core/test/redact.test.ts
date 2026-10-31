import { describe, expect, it } from "vitest";
import { REDACTED, Redactor } from "../src/audit/redact.ts";

describe("audit redaction", () => {
  it.each(["apiKey", "api_key", "secret", "accessToken", "password", "authorization", "cookie", "otp", "pin", "cvv", "card_number", "private_key", "refreshToken"])("redacts sensitive key %s", (key) => {
    expect(new Redactor().value({ nested: [{ [key]: "private", safe: "visible" }] })).toEqual({ nested: [{ [key]: REDACTED, safe: "visible" }] });
  });
  it("scrubs known values wherever they appear in nested values", () => {
    const r = new Redactor();
    r.remember("synthetic-secret");
    expect(r.value({ safe: ["prefix synthetic-secret suffix", { another: "synthetic-secret synthetic-secret" }], number: 42, nil: null }))
      .toEqual({ safe: [`prefix ${REDACTED} suffix`, { another: `${REDACTED} ${REDACTED}` }], number: 42, nil: null });
  });
  it.each([`sk-ant-${"a".repeat(20)}`, `AIza${"b".repeat(32)}`, "rzp_test_abcdefgh1234", `Bearer ${"c".repeat(24)}`])("scrubs key-shaped value %s", (value) => {
    const r = new Redactor();
    expect(r.text(`before ${value} after`)).toBe(`before ${REDACTED} after`);
    expect(r.value({ safe: [value] })).toEqual({ safe: [REDACTED] });
  });
  it("bounds string length, array length and recursion depth", () => {
    const r = new Redactor();
    expect(r.value("x".repeat(5000))).toBe(`${"x".repeat(4000)}…`);
    expect(r.value(Array.from({ length: 100 }, (_, i) => i))).toEqual(Array.from({ length: 50 }, (_, i) => i));
    const nested = (depth: number, leaf = "deep"): unknown => depth ? { child: nested(depth - 1, leaf) } : leaf;
    expect(r.value(nested(9))).toEqual(nested(9, "[…]"));
  });
});
