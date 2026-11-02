import { describe, expect, it } from "vitest";
import { boatCredential, voiceCredential, deciderCredential, researchCredential } from "./provider-credentials.ts";

describe("direct provider credentials", () => {
  it("does not resolve a credential from old included-service environment variables", () => {
    const old = { OMB_CLOUD_BOAT_TOKEN: "fixture-retired", OMB_CLOUD_BOAT_URL: "https://retired.example.test", OMB_CLOUD_VOICE_TOKEN: "fixture-retired", OMB_CLOUD_VOICE_URL: "https://retired.example.test", OMB_CLOUD_X_TOKEN: "fixture-retired", OMB_CLOUD_X_URL: "https://retired.example.test" };
    expect(boatCredential(undefined, old)).toBeNull();
    expect(voiceCredential(undefined, old)).toBeNull();
    expect(researchCredential(undefined, old)).toBeNull();
    expect(deciderCredential(undefined, undefined)).toBeNull();
  });
  it("uses only an explicitly supplied key with the independent provider", () => {
    expect(boatCredential(" fixture-boat ", {})).toEqual({ token: "fixture-boat", api: "https://boat.dev/api/v1" });
    expect(voiceCredential("fixture-voice", {})).toEqual({ token: "fixture-voice", api: "https://api.elevenlabs.io/v1" });
    expect(researchCredential("fixture-treg", {})).toEqual({ token: "fixture-treg", api: "https://treg.to" });
    expect(deciderCredential("fixture-jev", "https://own.example.test")).toEqual({ token: "fixture-jev", api: "https://own.example.test" });
  });
});
