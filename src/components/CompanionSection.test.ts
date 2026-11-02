import { describe, expect, it } from "vitest";


import { phonePairingManualCodeMode } from "../lib/companion-state";

import { loadCompanionBridgeState, deriveCompanionPanelStatus, deriveTailscalePairingStatus, pairingSurfaceCopy } from "./CompanionSection";


describe("companion status refresh", () => {
  it("omits the redundant status pill when device access is ready for its first pairing", () => {
    expect(deriveCompanionPanelStatus({
      enabled: true,
      devices: [],
    })).toBeNull();
  });

  it("does not show a healthy status when the enabled sidecar reports an error", () => {
    expect(deriveCompanionPanelStatus({
      enabled: true,
      devices: [],
      error: "sidecar stopped responding",
    })).toEqual({ label: "Remote access needs attention", good: false });
  });


});

describe("manual pairing code placement", () => {
  it("shows the code directly when no QR link can be built", () => {
    expect(phonePairingManualCodeMode(true, null)).toBe("direct");
  });

  it("keeps the code in troubleshooting details when a QR is available", () => {
    expect(phonePairingManualCodeMode(true, "openmausbot://pair?token=example")).toBe("details");
    expect(phonePairingManualCodeMode(false, null)).toBe("hidden");
  });
});


describe("Tailscale pairing onboarding", () => {
  it("keeps HTTPS as the recommended default surface", () => {
    expect(pairingSurfaceCopy({ localFallback: false, tailscaleFallback: false })).toEqual({
      title: "Secure HTTPS pairing",
      subtitle: "Recommended. The simplest setup, and it keeps working when the paired device leaves this Wi-Fi.",
    });
    expect(pairingSurfaceCopy({ localFallback: false, tailscaleFallback: true }).title).toBe(
      "Tailscale pairing",
    );
  });

  it("explains every step between unchecked and ready", () => {
    expect(deriveTailscalePairingStatus({ enabled: false }, false)).toMatchObject({
      kind: "unchecked",
      detail: expect.stringContaining("turns on Remote access"),
    });
    expect(deriveTailscalePairingStatus({ enabled: true }, false).kind).toBe("unavailable");
    expect(deriveTailscalePairingStatus({
      enabled: true,
      tailscale: "100.99.1.2",
    }, false).kind).toBe("magicdns");
    expect(deriveTailscalePairingStatus({
      enabled: true,
      tailscale: "100.99.1.2",
      tailnetName: "mac.tail1234.ts.net",
    }, true)).toMatchObject({
      kind: "ready",
      title: "Ready on mac.tail1234.ts.net",
    });
  });

  it("surfaces sidecar failures instead of pretending Tailscale is merely absent", () => {
    expect(deriveTailscalePairingStatus({
      enabled: true,
      error: "the companion is not responding",
    }, false)).toEqual({
      kind: "error",
      title: "Remote access needs attention",
      detail: "the companion is not responding",
    });
  });
});

it("refreshes only the local companion and tolerates a stopped sidecar", async () => { const local = { enabled: false, keepAwake: false, port: 8810, devices: [], pairing: null }; expect(await loadCompanionBridgeState({state: async () => local})).toEqual({companion: local}); expect(await loadCompanionBridgeState({state: async () => {throw new Error("stopped");}})).toEqual({companion: null}); });
