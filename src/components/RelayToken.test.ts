// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelayToken } from "./RelayToken";
import { tokenActivity } from "@/lib/token-state";
import { MAUS_STATES, stateForBot } from "@/lib/mascot";
import { BOT_BODY_IDS } from "../../shared/bot-body";
import { RELAY_MARK_PATH } from "./RelayMark";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
const show = (props: Partial<Parameters<typeof RelayToken>[0]> = {}) => act(() => root.render(createElement(RelayToken, {
  color: "blue", gradient: ["#377FE6", "#377FE6", "#377FE6"], label: "Atlas", ...props,
})));

describe("Relay token identity and state", () => {
  it("uses the original R mark for every stored body id, including seasonal profiles", () => {
    for (const bodyId of BOT_BODY_IDS) {
      show({ bodyId, animated: false });
      expect(host.querySelector(`path[d="${RELAY_MARK_PATH}"]`), bodyId).not.toBeNull();
      expect(host.querySelector("image"), bodyId).toBeNull();
      expect(host.querySelector("svg")?.getAttribute("data-animated")).toBe("false");
    }
  });
  it("updates activity and accessible status without relying on colour or animation", () => {
    const signals = new Set<string>();
    for (const [state, activity, text] of [
      ["idle", "idle", "Idle"], ["working", "working", "Working"], ["listening", "waiting", "Waiting"],
      ["alerting", "attention", "Needs attention"], ["happy", "complete", "Complete"],
    ] as const) {
      show({ state, animated: false });
      expect(host.querySelector("svg")?.getAttribute("data-activity")).toBe(activity);
      expect(host.querySelector("svg")?.getAttribute("aria-label")).toBe(`Atlas · ${text}`);
      signals.add(host.querySelector(".relay-token-signal-mark")!.getAttribute("d")!);
    }
    expect(signals.size).toBe(5);
  });
  it("maps every legacy expression to a supported activity signal", () => {
    for (const state of MAUS_STATES) expect(["idle", "working", "waiting", "attention", "complete"]).toContain(tokenActivity(state));
  });
  it("gives real work priority over a pinned appearance and keeps idle roles idle", () => {
    expect(stateForBot({ name: "Atlas", busy: true, mascotExpression: "sleeping" })).toBe("working");
    for (const title of ["Engineer", "Researcher", "Designer", "Security reviewer"]) expect(stateForBot({ name: "Atlas", title })).toBe("idle");
  });
  it("shows waiting when the runtime is waiting for a person, a computer or a teammate", () => {
    for (const activity of ["waiting-on-you", "parked.computer"] as const) {
      expect(stateForBot({ name: "Atlas", busy: true, activity, mascotExpression: "working" })).toBe("listening");
    }
    expect(stateForBot({ name: "Atlas", waitingForTeammates: true })).toBe("listening");
  });
  it("turns motion off under the operating system's reduced-motion preference", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
    show({ state: "working" });
    expect(host.querySelector("svg")?.getAttribute("data-animated")).toBe("false");
    expect(host.querySelector("svg")?.getAttribute("data-activity")).toBe("working");
    vi.restoreAllMocks();
  });
});
