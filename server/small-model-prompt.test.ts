import { describe, expect, it } from "vitest";

import { keepsForSmallWindow, smallWindowMachine } from "./small-model-prompt.ts";

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
});
