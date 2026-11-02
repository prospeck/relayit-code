import { describe, expect, it } from "vitest";

import { boatErrorMessage, boatRefusal } from "./boat.ts";

const billing = {
  ok: false,
  status: 402,
  code: "billing_required",
  message: "Start the $20/month Boat plan to create sandboxes.",
  error: {
    code: "billing_required",
    details: { billingUrl: "https://boat.dev/dashboard?tab=billing", accessTier: "trial" },
  },
};

describe("boatErrorMessage", () => {
  it("passes the provider's billing message through, with its link", () => {
    const msg = boatErrorMessage(402, "boat create", billing);
    expect(msg).toContain("$20/month Boat plan");
    expect(msg).toContain("https://boat.dev/dashboard?tab=billing");
    expect(msg).not.toMatch(/\(402\)/);
  });

  it("still says something useful when the provider says nothing", () => {
    expect(boatErrorMessage(402, "boat create", {})).toMatch(/paid Boat plan/i);
  });

  it("tells you to re-paste your own key on an auth failure", () => {
    expect(boatErrorMessage(401, "boat create", { message: "unauthorized" }))
      .toBe("boat.dev rejected your Boat API key — paste a current one in Settings → API keys");
  });



  it("names the rate limit rather than a bare status", () => {
    expect(boatErrorMessage(429, "boat create", { message: "Too many sandboxes created today." })).toBe(
      "Too many sandboxes created today.",
    );
  });

  it("falls back to the status when nothing is known", () => {
    expect(boatErrorMessage(500, "boat create")).toBe("boat create failed (500)");
  });
});

describe("boatRefusal", () => {


  it("never sets the status a route would answer with", () => {
    expect(boatRefusal(200, "boat create", { ok: false, message: "no sandbox" })).not.toHaveProperty("status");
    expect(boatRefusal(500, "boat create", { code: "Not A Code!" })).not.toHaveProperty("boatCode");
  });
});
