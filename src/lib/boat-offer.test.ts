import { describe, expect, it } from "vitest";
import { BOAT_OFFER, boatOfferRuns } from "./boat-offer";

describe("cloud provider information", () => {
  it("runs until its end date, and for good while none is set", () => {
    const end = Date.UTC(2026, 11, 1);
    expect(boatOfferRuns(end)).toBe(true);
    expect(boatOfferRuns(end - 1, { ...BOAT_OFFER, until: end })).toBe(true);
    expect(boatOfferRuns(end, { ...BOAT_OFFER, until: end })).toBe(false);
    expect(boatOfferRuns(end + 1, { ...BOAT_OFFER, until: end })).toBe(false);
  });
});
