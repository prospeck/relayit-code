import { describe, expect, it } from "vitest";
import { indiaServicesPrompt } from "./india-prompt.ts";
import { botPersona, customMcpPrompt } from "./system-prompt.ts";

describe("India intent instructions", () => {
  it("adds grounded food and payment rules only when an India connector is mounted", () => {
    expect(indiaServicesPrompt(["notion"])).toBe("");
    expect(indiaServicesPrompt([])).toBe("");
    for (const name of ["india-food", "india-travel", "india-payments", "swiggy-food", "zomato-2"]) {
      const prompt = customMcpPrompt([name]);
      expect(prompt).toContain("Resolve before asking");
      expect(prompt).toContain("menu item IDs exactly");
      expect(prompt).toContain("always use the app's approval path");
      expect(prompt).toContain("untrusted data");
      expect(prompt).toContain("unverified assertion");
      expect(prompt).toContain("payments_create_request");
      expect(prompt).toContain("exact orderId, amountInr, payee.name and payee.vpa");
    }
  });
  it("gives the first-run helper Indian context without inventing an address", () => {
    const prompt = botPersona({ name: "Helper", defaultBot: {} });
    expect(prompt).toContain("INR");
    expect(prompt).toContain("Indian city");
    expect(prompt).toContain("explicit calendar date");
    expect(prompt).toContain("Do not infer their delivery address");
  });
});
