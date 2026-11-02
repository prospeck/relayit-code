// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({
  api: vi.fn(),
  runMcpSignIn: vi.fn(),
}));
vi.mock("@/state/store", () => ({
  api: fixture.api,
  useStore: () => ({ state: { config: null, bots: [] }, dispatch: vi.fn() }),
}));
vi.mock("@/lib/mcp-sign-in", async (original) => ({
  ...(await original<typeof import("@/lib/mcp-sign-in")>()),
  runMcpSignIn: fixture.runMcpSignIn,
}));
vi.mock("@/lib/app-links", () => ({ openExternalLink: vi.fn(async () => {}) }));
vi.mock("@/lib/mcp-servers", () => ({ updateMcpServers: vi.fn() }));

import { McpServersPanel } from "./McpServersPanel";

const existing = { name: "swiggy-food", type: "http", url: "https://mcp.swiggy.com/food", headerKeys: [], enabled: false, auth: "needs-sign-in" };
let host: HTMLDivElement;
let root: Root;
let saved: typeof existing[];
const settle = () => act(async () => { for (let turn = 0; turn < 6; turn += 1) await Promise.resolve(); });
beforeEach(async () => {
  vi.clearAllMocks();
  setLocale("en");
  saved = [];
  fixture.runMcpSignIn.mockResolvedValue({ phase: "succeeded", flowId: null, authorizationUrl: null });
  fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/api/mcp/servers" && init?.method === "POST") { saved = [existing]; return { servers: saved }; }
    if (path === "/api/mcp/servers") return { servers: saved };
    if (path.endsWith("/test")) return { ok: true, tools: [{ name: "search_restaurants" }] };
    if (init?.method === "PATCH") { saved = [{ ...existing, enabled: true }]; return { servers: saved }; }
    throw new Error(`unexpected ${path}`);
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(McpServersPanel)));
  await settle();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("official MCP presets", () => {
  it("renders seven cards and adds a disabled server before OAuth, discovery and enable", async () => {
    expect(host.querySelectorAll('section[aria-label="Official connections"] button')).toHaveLength(7);
    await act(async () => (host.querySelector('[aria-label="Connect Swiggy Food"]') as HTMLButtonElement).click());
    await settle();
    expect(fixture.api).toHaveBeenCalledWith("/api/mcp/servers", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "swiggy-food", type: "http", url: existing.url, enabled: false }) }));
    expect(fixture.runMcpSignIn).toHaveBeenCalledWith("swiggy-food", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fixture.api).toHaveBeenCalledWith("/api/mcp/servers/swiggy-food/test", expect.anything());
    expect(saved[0]?.enabled).toBe(true);
  });
  it("keeps a failed discovery off", async () => {
    fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/test")) return { ok: false, error: "Fixture unavailable" };
      if (path === "/api/mcp/servers" && init?.method === "POST") saved = [existing];
      return { servers: saved };
    });
    await act(async () => (host.querySelector('[aria-label="Connect Swiggy Food"]') as HTMLButtonElement).click());
    await settle();
    expect(saved[0]?.enabled).toBe(false);
    expect(fixture.api.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });
});
