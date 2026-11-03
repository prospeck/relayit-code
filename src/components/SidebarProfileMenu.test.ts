import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { placeMenuItems, planUsageSummary, profileInitials, profileMenuItems, resetsIn, accountLabel, toolMenuItems, type PlanUsageWindows, profileLabel } from "./SidebarProfileMenu";

import { profileForSession } from "@/lib/session";


import type { SidebarMenuItem } from "./SidebarPopoverMenu";


import { InitialsAvatar } from "./Avatar";

describe("profileInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(profileInitials({ name: "Milind Soni" })).toBe("MS");
    expect(profileInitials({ name: "Ada Byron Lovelace" })).toBe("AB");
  });

  it("falls back to the email, then to a placeholder", () => {
    expect(profileInitials({ email: "you@x.dev" })).toBe("Y");
    expect(profileInitials({})).toBe("?");
    expect(profileInitials(undefined)).toBe("?");
  });

  it("ignores whitespace-only names", () => {
    expect(profileInitials({ name: "   ", email: "you@x.dev" })).toBe("Y");
  });
});

describe("profileLabel", () => {
  it("prefers the name, then the email, then You", () => {
    expect(profileLabel({ name: "Omkar", email: "o@x.dev" })).toBe("Omkar");
    expect(profileLabel({ email: "o@x.dev" })).toBe("o@x.dev");
    expect(profileLabel(undefined)).toBe("You");
  });
});

describe("the sidebar profile for a signed-in visitor", () => {
  it("uses the fallback while the session identity is still loading", () => {
    const visible = profileForSession(
      { name: "Owner", email: "owner@example.test", avatarUrl: "/owner.png" },
      null,
    );
    expect(profileLabel(visible)).toBe("You");
    expect(profileInitials(visible)).toBe("?");
    expect(visible?.avatarUrl).toBeUndefined();
  });

  it("shows the verified email and initials without the configured owner's name or avatar", () => {
    const visible = profileForSession(
      { name: "Owner", email: "owner@example.test", avatarUrl: "/owner.png" },
      { kind: "session", id: "s", label: "Ada's iPad", email: "ada@example.test", scopes: ["client"], expiresAt: 1 },
    );
    expect(profileLabel(visible)).toBe("ada@example.test");
    expect(profileInitials(visible)).toBe("A");
    expect(visible?.avatarUrl).toBeUndefined();
  });
});


describe("profileMenuItems", () => {
  const noop = () => {};
  const build = (patch: Partial<Parameters<typeof profileMenuItems>[0]> = {}) => profileMenuItems({
    phone: [{ key: "phone-app", label: "Get the phone app", onSelect: noop }],
    usage: true,


    onUsage: noop, onSettings: noop, onShortcuts: noop, onAbout: noop,
    ...patch,
  });

  it("groups local usage, phone pairing and settings without hosted account actions", () => {
    const items = build();
    expect(items.map((item) => item.key)).toEqual(["usage", "phone-app", "support", "settings"]);
    expect(items.filter((item) => item.separatorBefore).map((item) => item.key)).toEqual([]);
    expect(items.find((item) => item.key === "support")!.submenu!.map((item) => item.key)).toEqual(["shortcuts", "about"]);
    expect(items.some((item) => ["account"].includes(item.key))).toBe(false);
  });

  it("only offers what this window has: no usage on a remote server, no account without one", () => {
    const items = build({ usage: false,  });
    expect(items.map((item) => item.key)).toEqual(["phone-app", "support", "settings"]);
    expect(items.some((item) => item.separatorBefore)).toBe(false);
  });



  it("opens Usage in Settings", () => {
    const onUsage = vi.fn();
    const items = build({ onUsage });
    items.find((item) => item.key === "usage")!.onSelect();
    expect(onUsage).toHaveBeenCalledOnce();
  });
});

describe("Simple mode's account menu", () => {
  const noop = () => {};
  const tools = toolMenuItems({ activeView: "routines", automationsNeedYou: true, onAutomations: noop, onTeamMap: noop });
  const place = (patch: Partial<Parameters<typeof placeMenuItems>[0]> = {}) => ({
    bridge: { state: async () => ({ local: true, name: "This computer" }), menu: async () => {} },
    current: { local: true, name: "This computer" },
    cloudHome: false,
    onLine: "",
    openMenu: vi.fn(),
    switchable: true,
    ...patch,
  });
  const build = (patch: Partial<Parameters<typeof profileMenuItems>[0]> = {}) => profileMenuItems({
    phone: [{ key: "phone", label: "Connect your phone", onSelect: noop }],
    usage: true,


    simple: { tools, places: placeMenuItems(place(), { owner: null, onCloudSettings: noop }) },
    onUsage: noop, onSettings: noop, onShortcuts: noop, onAbout: noop,
    ...patch,
  });
  const groups = (items: SidebarMenuItem[]) => items.reduce<string[][]>((all, item) => {
    if (item.separatorBefore || all.length === 0) all.push([]);
    all[all.length - 1]!.push(item.key);
    return all;
  }, []);

  it("leads with usage, the phone app, support and Settings, then Automations and Team map, then where this window is and Cloud", () => {
    const items = build();
    expect(groups(items)).toEqual([
      ["usage", "phone", "support", "settings"],
      ["automations", "team-map"],
      ["place", "switch-place"],
    ]);
    expect(items.find((item) => item.key === "support")!.submenu!.map((item) => item.key)).toEqual(["shortcuts", "about"]);
  });



  it("gives the usage row a trailing meta and a chevron, with the reset as its second line", () => {
    const usage = build({ usageSummary: { value: "12% used", weekly: true, resets: "Resets in 3 days" } })[0]!;
    expect(usage).toMatchObject({ label: "Weekly usage", value: "12% used", subtitle: "Resets in 3 days", chevron: true });
    expect(build()[0]).toMatchObject({ label: "Usage", chevron: true });
    expect(build()[0]!.value).toBeUndefined();
  });

  it("keeps Advanced's account menu as it was", () => {
    const items = build({ simple: undefined, usageSummary: { value: "12% used" } });
    expect(items.map((item) => item.key)).toEqual(["usage", "phone", "support", "settings"]);
    expect(items[0]!.chevron).toBeUndefined();
  });

  it("adds Files once My Cloud's files are ready and Archived bots while there are any, after Team map", () => {
    const open = vi.fn();
    const items = toolMenuItems({ activeView: "files", automationsNeedYou: false, onAutomations: noop, onTeamMap: noop, onFiles: noop, archived: { count: 3, open } });
    expect(items.map((item) => [item.key, item.active, item.value])).toEqual([["automations", false, undefined], ["team-map", false, undefined], ["files", true, undefined], ["archived", undefined, "3"]]);
    items[3]!.onSelect();
    expect(open).toHaveBeenCalledOnce();
    expect(toolMenuItems({ activeView: "chat", automationsNeedYou: false, onAutomations: noop, onTeamMap: noop, archived: { count: 0, open } }).map((item) => item.key)).toEqual(["automations", "team-map"]);
  });

  it("names the account button after the person and whatever its dot is raised for", () => {
    expect(accountLabel("You", { automationsNeedYou: false,  })).toBe("You");
    expect(accountLabel("Ada", { automationsNeedYou: true,  })).toBe("Ada · Automations need you");
  });


  it("draws a person instead of a question mark for someone with no name, at the trigger's own size", () => {
    const glyph = createElement("svg", { "data-glyph": "" });
    const nameless = renderToStaticMarkup(createElement(InitialsAvatar, { initials: profileInitials({}), size: 36, fallback: glyph, fontSize: 14 }));
    expect(nameless).toContain("data-glyph");
    expect(nameless).not.toContain("?");
    expect(nameless).toContain("font-size:14px");
    expect(renderToStaticMarkup(createElement(InitialsAvatar, { initials: "AL", size: 50 }))).toContain("font-size:19px");
  });

  it("marks Automations open and needing attention, and Team map plain", () => {
    expect(tools.map((item) => [item.key, item.active, item.attention])).toEqual([["automations", true, true], ["team-map", false, undefined]]);
  });

  it("ticks the current place and switches through the same native menu as the server pill", () => {
    const here = place();
    const items = placeMenuItems(here, { owner: null, onCloudSettings: noop });
    expect(items.map((item) => [item.key, item.label])).toEqual([["place", "This computer"], ["switch-place", "Switch to…"]]);
    expect(items[0]!.trailing).toBeTruthy();
    items[0]!.onSelect();
    items[1]!.onSelect();
    expect(here.openMenu).toHaveBeenCalledTimes(2);
  });

  it("offers no entry for a server that is the window's only place: there is no hosted My Cloud to name or open", () => {
    const only = placeMenuItems(place({ switchable: false, cloudHome: true, onLine: "always on" }), { owner: "ada@example.test", onCloudSettings: noop });
    expect(only).toEqual([]);
    expect(placeMenuItems(place({ switchable: false, cloudHome: true, onLine: "" }), { owner: null, name: "Acme Labs", onCloudSettings: noop })).toEqual([]);
    expect(placeMenuItems(place({ bridge: undefined, switchable: false }), { owner: null, onCloudSettings: noop })).toEqual([]);
  });
});

describe("the usage meta", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  const window = (usedPercent: number | null, resetsAt: string | null = null) => ({ available: usedPercent !== null, usedPercent, resetsAt });
  const provider = (patch: Partial<PlanUsageWindows["providers"][number]> = {}) => ({ ok: true, plan: null, weekly: window(null), fiveHour: window(null), ...patch });

  it("reads the tightest weekly window, then the 5-hour one, with when it resets", () => {
    const report = { providers: [provider({ weekly: window(12, "2026-10-30T12:00:00Z") }), provider({ weekly: window(31.6, "2026-10-28T12:00:00Z") }), provider({ ok: false, weekly: window(90) })] };
    expect(planUsageSummary(report, now)).toEqual({ value: "32% used", weekly: true, resets: "Resets tomorrow" });
    expect(planUsageSummary({ providers: [provider({ fiveHour: window(40, "2026-10-27T15:00:00Z") })] }, now)).toEqual({ value: "40% used", weekly: false, resets: "Resets in 3 hours" });
  });

  it("falls back to a plan's monthly budget when it has no rolling window", () => {
    const report = { providers: [provider({ extra: [{ label: "Monthly spend", usedPercent: 9.3 }, { label: "Other", usedPercent: 80 }] })] };
    expect(planUsageSummary(report, now)).toEqual({ value: "9% used" });
    expect(planUsageSummary({ providers: [provider({ extra: [{ label: "Other", usedPercent: 80 }] })] }, now)).toBeNull();
  });

  it("shows nothing without a percent, not even the plan's name", () => {
    expect(planUsageSummary({ providers: [provider({ plan: "Max" })] }, now)).toBeNull();
    expect(planUsageSummary({ providers: [provider()] }, now)).toBeNull();
    expect(planUsageSummary(null, now)).toBeNull();
  });

  it("says when a reset is days away, and nothing once it has passed", () => {
    expect(resetsIn(now + 3 * 86_400_000, now)).toBe("Resets in 3 days");
    expect(resetsIn(now - 1, now)).toBeUndefined();
    expect(resetsIn(null, now)).toBeUndefined();
  });


});
