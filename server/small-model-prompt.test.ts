import { describe, expect, it } from "vitest";

import { indiaServersNotNeeded, keepsForSmallWindow, smallWindowMachine } from "./small-model-prompt.ts";

describe("the small-window prompt", () => {
  it("drops what runs a team, a computer or upkeep", () => {
    for (const part of ["coordination", "computer", "routine", "skills", "team-memory", "data"]) {
      expect(keepsForSmallWindow(part), part).toBe(false);
    }
  });

  it("keeps the person's task, and every part it doesn't know, so a safety section can't be lost by omission", () => {
    for (const part of ["user-profile", "memory", "browser", "mcp", "google", "composio", "webhook", "routine-execution", "automation-reply", "assignment", "a-new-part"]) {
      expect(keepsForSmallWindow(part), part).toBe(true);
    }
  });

  it("applies up to 16 GB machines", () => {
    expect(smallWindowMachine(8192)).toBe(true);
    expect(smallWindowMachine(16_384)).toBe(true);
    expect(smallWindowMachine(32_768)).toBe(false);
  });

  it("gives a turn the connectors its words point to", () => {
    expect(indiaServersNotNeeded("Order something from California Pizza")).toEqual(["india-travel"]);
    expect(indiaServersNotNeeded("Trains to Mysuru on Friday")).toEqual(["india-food", "india-payments"]);
    expect(indiaServersNotNeeded("metro to MG Road, then order lunch")).toEqual([]);
  });

  it("keeps food when the words name no domain, so a restaurant it doesn't recognise still works", () => {
    expect(indiaServersNotNeeded("get me something from Truffles")).toEqual(["india-travel", "india-payments"]);
    expect(indiaServersNotNeeded("get me something from Truffles")).not.toContain("india-food");
  });
});
