import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ section: "connections" as import("@/state/store").AppSettingsSection, config: undefined as import("@/state/store").ConfigStatus | undefined }));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({ state: { appSettingsSection: fixture.section, instances: [], config: fixture.config }, dispatch: vi.fn() }),
}));

beforeEach(() => {
  fixture.config = undefined;
  fixture.section = "connections";
  vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:8799" } });
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  setLocale("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("Settings → Connections", () => {
  it("keeps the fallback warning through status frames and shows it in Settings", async () => {
    const { configStatusFromFrame } = await import("@/state/store");
    const credentialStorage = { protection: "key-file" as const, label: "Weaker protection: local key file", detail: "Shared credential store: encrypted, but anyone who can read its local key file and ciphertext can decrypt it." };
    fixture.config = configStatusFromFrame({
      credentialStorage, composio: { configured: false }, box: { configured: false }, vps: { configured: false, sshAlias: "" },
      rooms: { turnTimeoutMinutes: 10 }, mcp: { callTimeoutMinutes: 10 }, localVm: { mode: "shared", maxInstances: 1 },
    });
    fixture.section = "general";
    expect(fixture.config.credentialStorage).toEqual(credentialStorage);
    const { SettingsModal } = await import("./SettingsModal");
    const html = renderToStaticMarkup(createElement(SettingsModal));
    expect(html).toContain(credentialStorage.label);
    expect(html).toContain(credentialStorage.detail);
  });
  it.each(["router", "OpenRouter", "base URL", "API key", "OpenAI", "Anthropic", "Groq"])("is found by searching for %s", async (typed) => {
    const { SECTIONS, sectionMatches } = await import("./SettingsModal");
    const connections = SECTIONS.find((entry) => entry.id === "connections")!;
    // The modal lowercases and trims what was typed before matching.
    expect(sectionMatches(connections, typed.trim().toLowerCase())).toBe(true);
  });

  it("points OpenCode users at `opencode auth login` for other providers", async () => {
    const { SettingsModal } = await import("./SettingsModal");
    const html = renderToStaticMarkup(createElement(SettingsModal));
    expect(html).toContain("More providers for OpenCode bots");
    expect(html).toContain('<code class="font-mono">opencode auth login</code>');
  });

  it("offers keys for other OpenCode providers next to the OpenCode key", async () => {
    const { SettingsModal } = await import("./SettingsModal");
    const html = renderToStaticMarkup(createElement(SettingsModal));
    const opencode = html.indexOf('data-api-key-row="opencodeGo"');
    expect(opencode).toBeGreaterThan(0);
    expect(html.indexOf("data-opencode-provider-keys")).toBeGreaterThan(opencode);
    expect(html).toContain("Keys for other OpenCode providers");
  });

  it("sends nobody on a Cloud to a terminal, only to the keys for other providers", async () => {
    const { configStatusFromFrame } = await import("@/state/store");
    fixture.config = configStatusFromFrame({
      composio: { configured: false },
      box: { configured: false },
      vps: { configured: false, sshAlias: "" },
      rooms: { turnTimeoutMinutes: 10 },
      mcp: { callTimeoutMinutes: 10 },
      localVm: { mode: "shared", maxInstances: 1 },
      cloudHome: true,
    });
    const { SettingsModal } = await import("./SettingsModal");
    const html = renderToStaticMarkup(createElement(SettingsModal));
    expect(html).toContain("OpenCode API key");
    expect(html).not.toContain("opencode auth login");
    expect(html).not.toContain("More providers for OpenCode bots");
    expect(html).toContain("Keys for other OpenCode providers");
  });
});
