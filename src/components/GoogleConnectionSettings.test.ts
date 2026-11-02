// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GoogleStatus } from "../../shared/google";

const fixture = vi.hoisted(() => ({ api: vi.fn(), open: vi.fn() }));
vi.mock("@/state/store", () => ({ api: fixture.api }));
vi.mock("@/lib/app-links", () => ({ openExternalLink: fixture.open }));
const { GoogleConnectionSettings } = await import("./GoogleConnectionSettings");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const none: GoogleStatus = { mode: "none", connected: false, clientConfigured: false, email: null, issues: [] };
beforeEach(() => {
  vi.useFakeTimers(); fixture.api.mockReset(); fixture.open.mockReset(); fixture.api.mockResolvedValue(none);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
const button = (label: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === label)!;
const render = () => act(async () => root.render(createElement(GoogleConnectionSettings)));
const click = (label: string) => act(async () => button(label).click());

it("offers a demo without requesting credentials and renders it as a demo", async () => {
  await render();
  fixture.api.mockResolvedValue({ ...none, connected: true, mode: "fake", email: "demo@example.test" });
  await click("Try a demo inbox");
  expect(fixture.api).toHaveBeenCalledWith("/api/google/connect", { method: "POST", body: '{"fake":true}' });
  expect(host.textContent).toContain("Connected · Demo inbox");
  expect(fixture.open).not.toHaveBeenCalled();
});

it("shows Needs attention, opens both project-specific console fixes and keeps rechecking until healthy", async () => {
  fixture.api.mockResolvedValue({ ...none, mode: "real", clientConfigured: true, issues: [
    { service: "Gmail", kind: "api_disabled", message: "Gmail is turned off", actionUrl: "https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=4815" },
    { service: "Google Calendar", kind: "api_disabled", message: "Calendar is turned off", actionUrl: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=4815" },
  ] });
  await render();
  expect(host.textContent).toContain("Needs attention");
  expect(button("Reconnect Google")).toBeTruthy();
  await click("Turn on Gmail API"); await click("Turn on Google Calendar API");
  expect(fixture.open.mock.calls.map(([url]) => url)).toEqual([
    "https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=4815",
    "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=4815",
  ]);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(fixture.api.mock.calls.filter(([path]) => path === "/api/google/health")).toHaveLength(2);
  fixture.api.mockResolvedValue({ ...none, mode: "real", clientConfigured: true, connected: true });
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(host.textContent).toContain("Connected");
  expect(host.textContent).not.toContain("Needs attention");
});

it("explains Desktop app setup, both API links and ticking every consent box", async () => {
  await render(); await click("Google setup");
  const dialog = host.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Desktop app");
  expect(dialog.textContent).toContain("tick every box");
  expect(dialog.querySelectorAll('input[type="password"]')).toHaveLength(2);
  await click("Turn on Gmail API");
  expect(fixture.open).toHaveBeenCalledWith("https://console.cloud.google.com/apis/library/gmail.googleapis.com");
});

it("reconnects using saved credentials, opens only Google's auth URL and supports blocked-popup recovery", async () => {
  fixture.api.mockResolvedValue({ ...none, clientConfigured: true });
  await render();
  fixture.api.mockResolvedValue({ ...none, clientConfigured: true, flow: { authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=fixture" } });
  await click("Reconnect Google");
  expect(fixture.api).toHaveBeenCalledWith("/api/google/connect", { method: "POST", body: "{}" });
  expect(fixture.open).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?state=fixture");
  expect(host.textContent).toContain("Waiting for Google sign-in");
  await click("Open Google sign-in");
  expect(fixture.open).toHaveBeenCalledTimes(2);
});
