import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { name: "OpenMausBot" },
  Menu: { buildFromTemplate: (template) => template },
}));

import { buildApplicationMenu } from "./menu.mjs";

describe("buildApplicationMenu", () => {
  const originalPlatform = process.platform;

  function withPlatform(platform, fn) {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    try {
      return fn();
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  }

  const environments = [{ id: "x", name: "X", origin: "http://localhost" }];
  const build = (platform, overrides = {}) =>
    withPlatform(platform, () =>
      buildApplicationMenu({
        environments,
        activeId: "x",
        onSwitch: vi.fn(),
        onAddFromClipboard: vi.fn(),
        onForget: vi.fn(),
        ...overrides,
      }),
    );

  it.each(["darwin", "linux", "win32"])("lists a saved local environment by its folder, so switching servers never fails on %s", platform => {
    const onSwitch = vi.fn();
    const local = { id: "e1", kind: "local", name: "Work", dataDir: "/Users/me/.openmausbot-work" };
    const tailnet = { id: "t1", name: "Mac mini", origin: "https://mac-mini.tail1f3f14.ts.net" };
    const template = build(platform, { environments: [local, tailnet], activeId: "t1", onSwitch });
    const items = template.find(entry => entry.label === "Server").submenu;
    expect(items.find(entry => entry.label === "Work — /Users/me/.openmausbot-work")).toMatchObject({ checked: false });
    expect(items.find(entry => entry.label === "Mac mini — mac-mini.tail1f3f14.ts.net")).toMatchObject({ checked: true });
    items.find(entry => entry.label.startsWith("Work")).click();
    expect(onSwitch).toHaveBeenCalledWith("e1");
  });

  it.each(["darwin", "linux", "win32"])("offers Open at Login on %s, in the app menu on macOS and the File menu elsewhere", (platform) => {
    const onToggle = vi.fn();
    const template = build(platform, { openAtLogin: { checked: false, onToggle } });
    const item = template[0].submenu.find((entry) => entry.id === "open-at-login");
    expect(template[0].label).toBe(platform === "darwin" ? "OpenMausBot" : "File");
    expect(item).toMatchObject({ label: "Open at Login", type: "checkbox", checked: false });
    item.click();
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(build(platform).flatMap((menu) => menu.submenu ?? []).some((entry) => entry.id === "open-at-login")).toBe(false);
  });

  it("macOS app menu wires an explicit Preferences item to the settings callback", () => {
    const onOpenSettings = vi.fn();
    const template = build("darwin", { onOpenSettings });
    const item = template[0].submenu.find((entry) => entry.label === "Preferences…");
    expect(item).toBeDefined();
    expect(item.accelerator).toBe("CmdOrCtrl+,");
    expect(item.click).toBeTypeOf("function");
    item.click();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it.each(["linux", "win32"])("does not add an app menu on %s", (platform) => {
    const template = build(platform);
    expect(template[0].role).toBe("fileMenu");
    for (const item of template) {
      expect(item.label).not.toBe("OpenMausBot");
    }
  });

  it.each(["darwin", "linux", "win32"])("offers no organization sign-in or cloud purchase actions on %s", platform => {
    const onOrganizationSignIn = vi.fn(), onAddCloud = vi.fn();
    const template = build(platform, { onOrganizationSignIn, onAddCloud });
    const items = template.find(entry => entry.label === "Server").submenu;
    expect(items.some(entry => ["organization-sign-in", "add-cloud", "back-to-my-cloud"].includes(entry.id))).toBe(false);
    expect(items.some(entry => entry.label === "Connect to a server…")).toBe(true);
    expect(onOrganizationSignIn).not.toHaveBeenCalled();
    expect(onAddCloud).not.toHaveBeenCalled();
  });




});
