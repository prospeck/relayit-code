// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { usePhoneSetupController, type CompanionState, type PhoneSetupController } from "./PhoneSetupFlow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; vi.unstubAllGlobals(); });
it("starts the sidecar and probes Tailscale only after an explicit route choice, without an account or network request", async () => {
  let state: CompanionState = { enabled: false, keepAwake: false, port: 8810, devices: [], pairing: null };
  const companion = {
    state: vi.fn(async () => state),
    start: vi.fn(async () => (state = { ...state, enabled: true })),
    refreshTailscale: vi.fn(async () => (state = { ...state, tailnetName: "computer.example.ts.net", endpoints: [{ kind: "tailnet", url: "http://computer.example.ts.net:8810", priority: 0 }] })),
    pairing: vi.fn(async (open: boolean) => (state = { ...state, pairing: open ? { code: "123456", token: `omb_pair_${"a".repeat(43)}`, expiresAt: Date.now() + 60_000 } : null })),
  };
  vi.stubGlobal("ogb", { companion });
  const network = vi.fn(() => { throw new Error("Unexpected network request"); }); vi.stubGlobal("fetch", network);
  let controller: PhoneSetupController | null = null;
  function Harness() { controller = usePhoneSetupController(); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Harness)));
  const current = () => controller!;
  expect(current().state?.enabled).toBe(false);
  await act(async () => current().start());
  expect(current().phase).toBe("sign-in");
  expect(companion.start).not.toHaveBeenCalled();
  await act(async () => current().useTailscale());
  expect(companion.start).toHaveBeenCalledOnce(); expect(companion.refreshTailscale).toHaveBeenCalledOnce();
  expect(companion.pairing).toHaveBeenCalledWith(true); expect(current().phase).toBe("qr");
  expect(current().pairingLink).toContain("computer.example.ts.net");
  expect(network).not.toHaveBeenCalled();
  await act(async () => current().cancel());
  expect(current().phase).toBe("intro"); expect(companion.pairing).toHaveBeenLastCalledWith(false, `omb_pair_${"a".repeat(43)}`);
});
