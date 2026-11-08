import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { SKINS, SKIN_IDS, DEFAULT_SKIN_CHOICE, PRIOR_INSTALL_SKIN, THEME_SKINS, resolveSkin } from "./skins";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../styles.css"),
  "utf8",
);

const blocks = new Set(
  [...css.matchAll(/\[data-skin="([a-z-]+)"\]/g)].map(([, id]) => id),
);

describe("skins", () => {
  it("gives every registered skin a stylesheet block", () => {
    for (const id of SKIN_IDS) expect(blocks).toContain(id);
  });

  it("registers every stylesheet block", () => {
    for (const id of blocks) expect(SKIN_IDS).toContain(id as (typeof SKIN_IDS)[number]);
  });

  it("defines the same tokens in every skin", () => {
    const tokensOf = (id: string) => {
      const body = css.match(new RegExp(`\\[data-skin="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name));
    };
    const reference = tokensOf(PRIOR_INSTALL_SKIN);
    expect(reference.size).toBeGreaterThan(15);
    expect(reference).toContain("--color-composer-ring");
    for (const id of SKIN_IDS) {
      expect([...reference].filter((t) => !tokensOf(id).has(t))).toEqual([]);
    }
  });

  it("tints a hovered menu row with ink at 6% by day and at night", () => {
    for (const id of SKIN_IDS) {
      const body = css.match(new RegExp(`\\[data-skin="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      const token = (name: string) => body.match(new RegExp(`(?:^|\\s)${name}:\\s*([^;]+);`))?.[1]?.trim();
      expect(token("--color-menu-hover"), id).toBe(`${token("--color-ink")}0f`);
    }
  });

  it("selects a code-only light or dark palette in every nearest skin", () => {
    for (const id of SKIN_IDS) {
      const body = css.match(new RegExp(`\\[data-skin="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      expect(body).toContain(`--code-color-scheme: ${id === "daylight" ? "light" : "dark"};`);
    }
    expect(css).toMatch(/\.chat-md \.shiki\s*\{\s*color-scheme:\s*var\(--code-color-scheme\);\s*\}/);
  });

  it("has one look, Lane, by day and at night", () => {
    expect(SKIN_IDS).toEqual(["daylight", "midnight"]);
    expect(SKINS.map((s) => s.name)).toEqual(["Day", "Night"]);
    expect(PRIOR_INSTALL_SKIN).toBe("midnight");
  });

  it("follows the computer between day and night by default", () => {
    expect(DEFAULT_SKIN_CHOICE).toBe("system");
    expect(THEME_SKINS).toEqual({ light: "daylight", dark: "midnight" });
    expect(resolveSkin("system", false)).toBe("daylight");
    expect(resolveSkin("system", true)).toBe("midnight");
    expect(resolveSkin("daylight", true)).toBe("daylight");
  });

  it("inverts your own bubble in both, each with its own scope", () => {
    for (const id of SKIN_IDS) {
      expect(css).toMatch(new RegExp(`@scope \\(\\[data-skin="${id}"\\]\\) to \\(\\[data-skin\\]\\)\\s*\\{\\s*\\.bg-bubble-user\\s*\\{`));
    }
  });

  it("puts black, not white, on a coral fill", () => {
    for (const id of SKIN_IDS) {
      const body = css.match(new RegExp(`\\[data-skin="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      expect(body, id).toMatch(/--color-accent-ink: #111111;/);
    }
  });

  it("describes each skin exactly once", () => {
    expect(SKINS.map((s) => s.id).sort()).toEqual([...SKIN_IDS].sort());
    for (const skin of SKINS) {
      expect(skin.name.length).toBeGreaterThan(0);
      expect(skin.tagline.length).toBeGreaterThan(0);
    }
  });
});
