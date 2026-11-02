// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { DesktopWorkspaceSwitcher } from "./DesktopWorkspaceSwitcher";

let host: HTMLDivElement;
let root: Root;
const menu = vi.fn(() => Promise.resolve());
const show = async (state: Record<string, unknown>, props: Record<string, unknown> = {}, plan?: Record<string, unknown>) => {
  window.ogb = { workspaces: { state: vi.fn().mockResolvedValue(state), menu },
    ...(plan ? { cloudPlan: { state: vi.fn().mockResolvedValue(plan), manage: vi.fn() } } : {}) } as unknown as typeof window.ogb;
  flushSync(() => root.render(createElement(DesktopWorkspaceSwitcher, props)));
  await vi.waitFor(() => expect(host.innerHTML).not.toBe(""));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => { setLocale("en"); menu.mockClear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { flushSync(() => root.unmount()); host.remove(); delete window.ogb; });


it("anywhere else keeps the switcher as it was", async () => {
  await show({ local: false, name: "My Cloud", origin: "https://omb-u-1a2b3c4d5e6f.server.example.test" }, { cloudHome: true });
  expect(host.querySelector("button")?.getAttribute("aria-haspopup")).toBe("menu");
  await show({ local: true, name: "This computer" });
  expect(host.querySelector("button")?.textContent).toContain("This computer");
});


