import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import axe from "axe-core";
import type { Locator, Page } from "playwright-core";
import type { PendingAction } from "@relayit/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { launchChrome, visible } from "./helpers/browser.ts";
import { UiHarness } from "./helpers/harness.ts";

// Audit findings and exact proposed fixes: docs/a11y-audit.md.
// Keep setup outside it.fails: a broken fixture must fail normally, not count as a known defect.
const css = await readFile(new URL("../apps/desktop/src/styles/index.css", import.meta.url), "utf8");
const [day, night = ""] = css.split("@media (prefers-color-scheme: dark)");
const declarations = (s: string) => Object.fromEntries([...s.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!]));
const light = declarations(day!);
const tokens = { light, dark: { ...light, ...declarations(night.split("@theme inline")[0]!) } };
type RGB = [number, number, number];
function rgb(value: string, under: RGB = [255, 255, 255]): RGB {
  if (/^#[\da-f]{6}$/i.test(value)) return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as RGB;
  const [r, g, b, alpha = 1] = value.match(/[\d.]+/g)!.map(Number);
  return [r!, g!, b!].map((v, i) => v * alpha + under[i]! * (1 - alpha)) as RGB;
}
function contrast(foreground: RGB, background: RGB): number {
  const luminance = (color: RGB) => color.map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
  const [low, high] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (high! + 0.05) / (low! + 0.05);
}

for (const scheme of ["light", "dark"] as const) {
  describe(`${scheme} token contrast (unrounded WCAG sRGB)`, () => {
    const t = tokens[scheme];
    for (const fg of ["text", "text-2", "muted", "faint"]) {
      for (const bg of ["bg", "surface", "surface-2", "bg-sidebar", "surface-3"]) {
        // A01: fixed list, not auto-classification by the measured result.
        it(`${fg} on ${bg} meets 4.5:1`, () => {
          expect(contrast(rgb(t[fg]!), rgb(t[bg]!))).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    for (const fg of ["accent-text", "success", "warning", "danger", "info"]) {
      const soft = fg === "accent-text" ? "accent-soft" : `${fg}-soft`;
      for (const base of ["bg", "surface"]) {
        it(`${fg} on ${soft} over ${base} meets 4.5:1`, () => {
          expect(contrast(rgb(t[fg]!), rgb(t[soft]!, rgb(t[base]!)))).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    for (const bg of ["accent", "accent-hover", "accent-press"]) {
      it(`on-accent text on ${bg} meets 4.5:1`, () => {
        expect(contrast(rgb(t["on-accent"]!), rgb(t[bg]!))).toBeGreaterThanOrEqual(4.5);
      });
    }
    it("the proposed replacements meet 4.5:1 on their actual backgrounds [A01]", () => {
      const proposed = scheme === "light"
        ? { muted: "#6b655d", faint: "#6b655d", "accent-text": "#a93c1b", success: "#196c45", warning: "#805209", danger: "#b5322c", info: "#315fc0" }
        : { faint: "#a19990" };
      for (const [fg, hex] of Object.entries(proposed)) {
        for (const bg of ["bg", "surface", "surface-2", "bg-sidebar", "surface-3"]) {
          expect(contrast(rgb(hex), rgb(t[bg]!)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
        const soft = fg === "accent-text" ? "accent-soft" : `${fg}-soft`;
        if (t[soft]) for (const base of ["bg", "surface"]) expect(contrast(rgb(hex), rgb(t[soft]!, rgb(t[base]!)))).toBeGreaterThanOrEqual(4.5);
      }
      for (const bg of scheme === "light" ? ["#bd431f", "#ac391a", "#963116"] : [t.accent!, t["accent-hover"]!, t["accent-press"]!]) {
        expect(contrast(rgb(scheme === "light" ? "#ffffff" : "#1c1a16"), rgb(bg))).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
}

const { browser, skipReason } = await launchChrome();
afterAll(async () => { await browser?.close(); });

async function tabTo(page: Page, locator: Locator): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press("Tab");
    if (await locator.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`Could not reach ${locator} with Tab`);
}
async function focusStyle(locator: Locator): Promise<{ visible: boolean; indicator: boolean }> {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return { visible: Number(style.opacity) > 0 && style.visibility === "visible", indicator: style.boxShadow !== "none" || (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) };
  });
}
async function textOverflow(page: Page): Promise<string[]> {
  return page.locator("main").evaluate((main) => [...main.querySelectorAll<HTMLElement>("*")].filter((el) => {
    const s = getComputedStyle(el);
    return s.display !== "inline" && s.display !== "none" && s.visibility !== "hidden" && el.getBoundingClientRect().height > 0
      && !!el.textContent?.trim() && s.overflowX === "visible" && el.scrollWidth > el.clientWidth + 2;
  }).map((el) => `${el.tagName}: ${el.textContent?.trim().slice(0, 90)} (${el.clientWidth}/${el.scrollWidth})`));
}

// Chrome absence fails this audit suite: an unexecuted browser audit must not look green.
describe("RelayIt accessibility and interaction audit", () => {
  let ui: UiHarness;
  beforeAll(() => { expect(browser, skipReason ?? "Chrome must launch").not.toBeNull(); });
  afterAll(async () => { await ui?.close(); });

  async function fresh(scheme: "light" | "dark"): Promise<void> {
    if (ui) await ui.reset();
    else ui = await UiHarness.start(browser!);
    await ui.page.emulateMedia({ colorScheme: scheme });
    await ui.onboard();
    await ui.open();
    await visible(ui.page.locator("main h1"));
  }
  async function demo(): Promise<void> {
    await ui.sendFromToday("Try a demo action");
    await visible(ui.page.getByRole("heading", { name: "Send note to Priya", exact: true }));
    await ui.waitForIdle();
  }
  async function money(): Promise<void> {
    await ui.sendFromToday("Order something from California Pizza");
    await visible(ui.page.getByRole("button", { name: /^Hold to approve/ }));
    await ui.waitForIdle();
  }

  for (const scheme of ["light", "dark"] as const) {
    for (const screen of ["Today", "Chat", "Activity", "Model", "Connections", "Tasks"] as const) {
      describe(`${scheme} / ${screen}`, () => {
        let scan: axe.AxeResults;
        let initialized = false;
        beforeEach(async () => {
          if (initialized) return;
          await fresh(scheme);
          if (screen === "Chat" || screen === "Activity") await demo();
          if (screen === "Model") {
            await ui.nav("Settings");
            await ui.page.getByRole("button", { name: "Model", exact: true }).click();
          } else if (screen === "Tasks") {
            for (const status of ["needs_you", "working", "review", "done"] as const) await ui.app.tasks.upsert({ title: "Synthetic accessibility task", detail: "Review this offline fixture", status, source: "Demo" });
            ui.app.bus.emit({ type: "tasks.updated" });
            await ui.nav("Tasks");
          } else if (screen !== "Today" && screen !== "Chat") await ui.nav(screen);
          await visible(ui.page.locator("main h1").last());
          // Route changes cross-fade; scan only once the previous screen has fully left.
          await expect.poll(() => ui.page.locator("main h1").count()).toBe(1);
          const expected: Record<string, RegExp> = { Today: /^Good /, Activity: /^Activity$/, Model: /^Model$/, Connections: /^Connections$/, Tasks: /^Tasks$/, Chat: /./ };
          await expect.poll(() => ui.page.locator("main h1").textContent()).toMatch(expected[screen]!);
          // Wait for the entry fade so axe does not silently put animated text into incomplete.
          await expect.poll(() => ui.page.locator("main > div.relative").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
          // Enter animations (messages, cards) fade in with inline opacity; slow CI runners can scan mid-fade.
          await expect.poll(() => ui.page.locator("main").evaluate((main) =>
            [...main.querySelectorAll<HTMLElement>("[style*='opacity']")].every((el) => { const o = getComputedStyle(el).opacity; return o === "1" || o === "0"; })), { timeout: 10_000 }).toBe(true);
          await ui.page.addScriptTag({ content: axe.source });
          scan = await ui.page.evaluate(async () => (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
          }));
          initialized = true;
        }, 30_000);

        it("has no untracked axe WCAG 2.1 A/AA violations", () => {
          const known = screen === "Chat" ? ["color-contrast", "definition-list"] : ["color-contrast"];
          expect(scan.violations.filter((v) => !known.includes(v.id)).map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
          expect(ui.uncaughtErrors).toEqual([]);
          expect(ui.consoleErrors).toEqual([]);
        });
        // A01: real violations, not disabled axe rules; an unexpected pass requests removal of it.fails.
        it("has no axe text contrast violations [A01]", () => {
          expect(scan.violations.filter((v) => v.id === "color-contrast").flatMap((v) => v.nodes.map((n) => `${n.target.join(" ")} :: ${n.html.slice(0, 120)} :: ${n.failureSummary?.split("\n").pop()}`))).toEqual([]);
        });
        if (screen === "Chat") it("uses valid approval definition-list markup [A09]", () => {
          expect(scan.violations.filter((v) => v.id === "definition-list")).toEqual([]);
        });
        const headings = ["Chat", "Model", "Connections"].includes(screen) ? it : it;
        headings("has one nonempty h1 and no skipped heading levels [A12]", async () => {
          const levels = await ui.page.locator("main h1, main h2, main h3, main h4").evaluateAll((els) => els.map((el) => ({ level: Number(el.tagName[1]), text: el.textContent?.trim() })));
          expect(levels.filter((h) => h.level === 1)).toHaveLength(1);
          expect(levels[0]?.text).toBeTruthy();
          expect(levels.filter((h, i) => i > 0 && h.level > levels[i - 1]!.level + 1)).toEqual([]);
        });
        for (const size of [{ width: 940, height: 620 }, { width: 1600, height: 1000 }]) {
          const test = size.width === 940 && ["Model", "Tasks"].includes(screen) ? it : it;
          test(`keeps text layouts within their containers at ${size.width}×${size.height} [A06]`, async () => {
            await ui.page.setViewportSize(size);
            expect(await textOverflow(ui.page)).toEqual([]);
          });
        }
      });
    }

    describe(`${scheme} / keyboard and status`, () => {
      beforeEach(async () => { await fresh(scheme); });
      it("tabs to sidebar items and shows focus on buttons and cards", async () => {
        const tasks = ui.page.locator("aside").getByRole("button", { name: "Tasks", exact: true });
        await tabTo(ui.page, tasks);
        expect(await focusStyle(tasks)).toEqual({ visible: true, indicator: true });
        await ui.page.keyboard.press("Enter");
        await visible(ui.page.getByRole("heading", { name: "Tasks", exact: true }));
        await ui.nav("Routines");
        const card = ui.page.getByRole("button", { name: /^Week ahead Every Monday/ });
        await tabTo(ui.page, card);
        expect(await focusStyle(card)).toEqual({ visible: true, indicator: true });
      });
      it("supports slash ArrowDown/ArrowUp and Enter selection", async () => {
        const composer = ui.page.locator("main textarea");
        await composer.fill("/");
        const options = ui.page.locator("main button").filter({ hasText: /^\/[a-z]/ });
        await visible(options.nth(1));
        const slugs = await options.evaluateAll((els) => els.map((el) => el.textContent!.match(/^\/([a-z0-9-]+)/)![1]!));
        await composer.press("ArrowDown"); await composer.press("ArrowDown"); await composer.press("ArrowUp"); await composer.press("Enter");
        expect(await composer.inputValue()).toBe(`/${slugs[1]} `);
      });
      // A07: Escape has no handler; the skill buttons remain visible.
      it("dismisses the slash popup with Escape [A07]", async () => {
        const composer = ui.page.locator("main textarea");
        await composer.fill("/");
        await visible(ui.page.locator("main button").filter({ hasText: /^\/[a-z]/ }).first());
        await composer.press("Escape");
        await expect.poll(() => ui.page.locator("main button").filter({ hasText: /^\/[a-z]/ }).count()).toBe(0);
      });
      it("traps dialog focus, closes dialog/select with Escape, and restores select focus", async () => {
        await ui.nav("Connections");
        const add = ui.page.getByRole("button", { name: "Add server", exact: true });
        await tabTo(ui.page, add); await ui.page.keyboard.press("Enter");
        const dialog = ui.page.getByRole("dialog", { name: "Add an MCP server" });
        await visible(dialog);
        for (let i = 0; i < 8; i++) {
          await ui.page.keyboard.press("Tab");
          expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
        }
        await ui.page.keyboard.press("Escape");
        await expect.poll(() => dialog.count()).toBe(0);
        await ui.nav("Settings"); await ui.page.getByRole("button", { name: "Model", exact: true }).click();
        const select = ui.page.getByRole("combobox").first();
        await tabTo(ui.page, select); await ui.page.keyboard.press("Space");
        await visible(ui.page.getByRole("listbox")); await ui.page.keyboard.press("ArrowDown"); await ui.page.keyboard.press("Escape");
        await expect.poll(() => ui.page.getByRole("listbox").count()).toBe(0);
        await expect.poll(() => select.evaluate((el) => el === document.activeElement)).toBe(true);
      });
      it("restores focus to the Add server button after dialog Escape [A15]", async () => {
        await ui.nav("Connections");
        const add = ui.page.getByRole("button", { name: "Add server", exact: true });
        await tabTo(ui.page, add); await ui.page.keyboard.press("Enter");
        await visible(ui.page.getByRole("dialog", { name: "Add an MCP server" }));
        await ui.page.keyboard.press("Escape");
        await expect.poll(() => ui.page.getByRole("dialog").count()).toBe(0);
        await expect.poll(() => add.evaluate((el) => el === document.activeElement)).toBe(true);
      });
      it("operates a named switch and task popover with keyboard and Escape", async () => {
        await ui.nav("Connections");
        const toggle = ui.page.getByRole("switch", { name: "Enable RelayIt Food (demo)", exact: true });
        await tabTo(ui.page, toggle);
        expect(await focusStyle(toggle)).toEqual({ visible: true, indicator: true });
        await ui.page.keyboard.press("Space");
        await expect.poll(() => toggle.getAttribute("aria-checked")).toBe("false");
        await ui.page.keyboard.press("Space");
        await expect.poll(() => toggle.getAttribute("aria-checked")).toBe("true");
        await ui.app.tasks.upsert({ title: "Keyboard task", detail: "Synthetic", source: "Demo", status: "needs_you" });
        ui.app.bus.emit({ type: "tasks.updated" });
        await ui.nav("Tasks");
        const more = ui.page.getByRole("button", { name: /^Actions for / }).first();
        await tabTo(ui.page, more); await ui.page.keyboard.press("Enter");
        await visible(ui.page.getByRole("button", { name: "Move to Working", exact: true }));
        await ui.page.keyboard.press("Escape");
        await expect.poll(() => ui.page.getByRole("button", { name: "Move to Working", exact: true }).count()).toBe(0);
        await expect.poll(() => more.evaluate((el) => el === document.activeElement)).toBe(true);
      });
      it("keeps task-menu triggers visible on keyboard focus [A05]", async () => {
        await ui.app.tasks.upsert({ title: "Keyboard task", detail: "Synthetic", source: "Demo", status: "needs_you" });
        ui.app.bus.emit({ type: "tasks.updated" });
        await ui.nav("Tasks"); await ui.page.mouse.move(0, 0);
        const more = ui.page.getByRole("button", { name: /^Actions for / }).first();
        await tabTo(ui.page, more);
        expect((await focusStyle(more)).visible).toBe(true);
      });
      it("exposes recent-chat deletion without hovering [A05]", async () => {
        await demo(); await ui.page.mouse.move(0, 0);
        expect(await ui.page.locator('aside button[aria-label^="Delete chat"]').first().isVisible()).toBe(true);
      });
      it("announces the selected Activity segment [A08]", async () => {
        await ui.nav("Activity");
        const filter = ui.page.locator("main").getByRole("button", { name: "Approvals", exact: true });
        await tabTo(ui.page, filter); await ui.page.keyboard.press("Space");
        expect(await filter.getAttribute("aria-pressed")).toBe("true");
      });
      it("has accessible names for notification switches [A10]", async () => {
        await ui.nav("Settings"); await ui.page.getByRole("button", { name: "Brief & alerts", exact: true }).click();
        const switches = ui.page.getByRole("switch");
        await visible(switches.first());
        expect(await switches.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")))).toEqual(["Morning brief on first open", "Desktop notifications"]);
      });
      it("gives key-dialog inputs an accessible name [A10]", async () => {
        await ui.nav("Connections");
        await ui.page.locator("div.py-2").filter({ hasText: "Exa (web research)" }).getByRole("button", { name: "Add", exact: true }).click();
        const dialog = ui.page.getByRole("dialog", { name: "Exa (web research)", exact: true });
        await visible(dialog); await ui.page.addScriptTag({ content: axe.source });
        const scan = await ui.page.evaluate(async () => (window as unknown as { axe: typeof axe }).axe.run(document, { runOnly: ["label"] }));
        expect(scan.violations).toEqual([]);
      });
      it("starts voice recording with the keyboard [A03]", async () => {
        // Observe permission requests without recording audio or accessing a real microphone.
        await ui.page.evaluate(() => {
          (window as unknown as { micRequests: number }).micRequests = 0;
          navigator.mediaDevices.getUserMedia = async () => { (window as unknown as { micRequests: number }).micRequests++; throw new DOMException("Synthetic denial", "NotAllowedError"); };
        });
        const mic = ui.page.getByRole("button", { name: "Hold to talk", exact: true });
        await tabTo(ui.page, mic); await ui.page.keyboard.press("Space");
        expect(await ui.page.evaluate(() => (window as unknown as { micRequests: number }).micRequests)).toBe(1);
      });
      it("uses a live region for new approval cards [A04]", async () => {
        await demo();
        const announced = await ui.page.getByRole("heading", { name: "Send note to Priya" }).first().evaluate((el) => !!el.closest('[aria-live="polite"], [role="log"], [role="status"]'));
        expect(announced).toBe(true);
      });
      it("provides at least 24×24px key-link and switch targets [A11]", async () => {
        await ui.nav("Connections");
        const targets = ui.page.locator('main [role="switch"], main button[aria-label^="Get a "]');
        await visible(targets.first());
        const small = await targets.evaluateAll((els) => els.map((el) => ({ name: el.getAttribute("aria-label"), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })).filter((b) => b.width < 24 || b.height < 24));
        expect(small).toEqual([]);
      });
    });

    describe(`${scheme} / keyboard money hold`, () => {
      beforeEach(async () => { await fresh(scheme); await money(); });
      for (const key of ["Enter", "Space"]) {
        it(`rejects a short ${key} press and approves exactly once after a full hold`, async () => {
          const button = ui.page.getByRole("button", { name: /^Hold to approve/ });
          await tabTo(ui.page, button);
          expect(await focusStyle(button)).toEqual({ visible: true, indicator: true });
          await ui.page.keyboard.down(key); await delay(100); await ui.page.keyboard.up(key); await delay(800);
          expect((await ui.api<PendingAction[]>("/api/actions"))[0]!.status).toBe("pending");
          const requests: string[] = [];
          ui.page.on("request", (r) => { if (r.method() === "POST" && /\/api\/actions\/[^/]+\/approve$/.test(r.url())) requests.push(r.url()); });
          await ui.page.keyboard.down(key); await delay(200); await ui.page.keyboard.down(key); await delay(800); await ui.page.keyboard.up(key);
          await visible(ui.page.getByText("Scan to pay with any UPI app", { exact: true }));
          expect(requests).toHaveLength(1);
        });
      }
      it("cancels a money hold when keyboard focus leaves [A02]", async () => {
        const button = ui.page.getByRole("button", { name: /^Hold to approve/ });
        await tabTo(ui.page, button);
        await ui.page.keyboard.down("Enter"); await ui.page.keyboard.press("Tab"); await ui.page.keyboard.up("Enter"); await delay(950);
        expect((await ui.api<PendingAction[]>("/api/actions"))[0]!.status).toBe("pending");
      });
      it("wraps long approval amounts, recipients and short detail values at minimum size [A06]", async () => {
        const action = (await ui.api<PendingAction[]>("/api/actions"))[0]!;
        // Synthetic persisted fixture: no real recipient or payment is involved.
        await ui.app.db.updateTable("pending_actions").set({ amount_inr: 12345678.9, recipient: "AlexandriaVeryLongRecipientNameWithoutSpacesForLayoutOnly", details: JSON.stringify([{ label: "Recipient", value: "synthetic-recipient-with-an-unbroken-identifier-for-layout-only" }]) }).where("id", "=", action.id).execute();
        await ui.page.reload(); await visible(ui.page.getByText("You'll pay", { exact: true }));
        await ui.page.setViewportSize({ width: 940, height: 620 });
        const clipped = await ui.page.locator('main [role="region"]').first().evaluate((card) => [...card.querySelectorAll<HTMLElement>("dd, p, span, div")].filter((el) => el.children.length === 0 && !!el.textContent?.trim() && el.scrollWidth > el.clientWidth + 2).map((el) => el.textContent));
        expect(clipped).toEqual([]);
      });
    });

    describe(`${scheme} / reduced motion and streaming`, () => {
      beforeEach(async () => {
        await fresh(scheme); await demo();
        await ui.page.emulateMedia({ reducedMotion: "reduce" });
        ui.app.bus.emit({ type: "run.started", runId: "a11y-status", conversationId: ui.page.url().split("#/chat/")[1]! });
        await visible(ui.page.locator(".shimmer", { hasText: "Thinking…" }));
      });
      it("reduces CSS shimmer animation duration", async () => {
        const duration = await ui.page.locator(".shimmer", { hasText: "Thinking…" }).evaluate((el) => getComputedStyle(el).animationDuration);
        expect(parseFloat(duration)).toBeLessThanOrEqual(0.00001);
      });
      it("announces Thinking and streaming replies [A04]", async () => {
        // The visible shimmer is decorative; a mounted polite status carries the same text for screen readers.
        expect(await ui.page.locator('[role="status"]', { hasText: "Thinking…" }).count()).toBeGreaterThan(0);
      });
      it("stops the JavaScript logo pulse with reduced motion [A13]", async () => {
        const transforms = [];
        for (let i = 0; i < 3; i++) {
          transforms.push(await ui.page.locator(".shimmer", { hasText: "Thinking…" }).evaluate((el) => getComputedStyle(el.parentElement!.previousElementSibling!.firstElementChild!).transform));
          await delay(120);
        }
        expect(new Set(transforms).size).toBe(1);
      });
    });
  }
});
