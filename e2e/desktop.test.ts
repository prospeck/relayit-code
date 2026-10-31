import { setTimeout as delay } from "node:timers/promises";
import type { AppState, ApprovalRule, PendingAction } from "@relayit/shared";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { enabled, hidden, launchChrome, visible } from "./helpers/browser.ts";
import { UiHarness, holdToApprove } from "./helpers/harness.ts";

const { browser, skipReason } = await launchChrome();
const demoApprovalBlocker = "blocked by live.ts:100: fast demo updates can be lost during Chat's initial fetch; see README.md";
afterAll(async () => { await browser?.close(); });

describe.skipIf(!browser)(`RelayIt desktop UI${skipReason ? ` — ${skipReason}` : ""}`, () => {
  let ui: UiHarness;

  beforeEach(async () => {
    if (ui) await ui.reset();
    else ui = await UiHarness.start(browser!);
  });

  afterEach(async () => {
    if (!ui) return;
    await ui.context?.close();
    expect(ui.uncaughtErrors, "Uncaught browser errors").toEqual([]);
    expect(ui.consoleErrors, "Browser console errors").toEqual([]);
  });

  afterAll(async () => { await ui?.close(); });

  async function openToday(): Promise<void> {
    await ui.onboard();
    await ui.open();
    await visible(ui.page.getByRole("heading", { name: /Good .*, Asha\./ }));
  }

  async function demoAction(): Promise<void> {
    await openToday();
    await ui.sendFromToday("Try a demo action");
    await visible(ui.page.getByRole("heading", { name: "Send note to Priya", exact: true }));
    await enabled(ui.page.getByRole("button", { name: "Refuse", exact: true }));
    await enabled(ui.page.getByRole("button", { name: "Always allow", exact: true }));
    await enabled(ui.page.getByRole("button", { name: "Allow once", exact: true }));
    await ui.waitForIdle();
  }

  async function sentNote(): Promise<void> {
    await visible(ui.page.getByText(/Done\. The note to Priya was sent/));
    await ui.waitForIdle();
    await visible(ui.page.getByText(/^Done\s*\d/));
    await hidden(ui.page.getByRole("button", { name: "Allow once", exact: true }));
  }

  it("onboards through name, places, model and promises, then greets the user on Today", async () => {
    await ui.open();
    await ui.page.getByPlaceholder("Your first name").fill("Meera");
    await ui.page.getByRole("button", { name: "Continue", exact: true }).click();
    await ui.page.getByRole("button", { name: "Pune", exact: true }).click();
    await ui.page.getByPlaceholder("Flat, building, street, area").fill("1 Test Street");
    await ui.page.getByRole("button", { name: "Continue", exact: true }).click();
    await ui.page.getByRole("button", { name: /^Ollama Runs on this computer/ }).click();
    await enabled(ui.page.getByRole("button", { name: "Continue", exact: true }));
    await ui.page.getByRole("button", { name: "Continue", exact: true }).click();
    for (const promise of ["It asks before it acts", "It never touches your money", "Everything stays here"]) {
      await visible(ui.page.getByText(promise, { exact: true }));
    }
    await ui.page.getByRole("button", { name: "Start using RelayIt", exact: true }).click();
    await expect.poll(() => ui.page.url()).toContain("#/today");
    await visible(ui.page.getByRole("heading", { name: /Good .*, Meera\./ }));
    expect(await ui.api<AppState>("/api/state")).toMatchObject({
      onboarded: true,
      profile: { name: "Meera", city: "Pune", addresses: [{ label: "Home", line: "1 Test Street" }] },
      model: { provider: "ollama" },
    });
  });

  it(`allows a demo note once, collapses the card and records all approval stages in Activity (${demoApprovalBlocker})`, async () => {
    await demoAction();
    await ui.page.getByRole("button", { name: "Allow once", exact: true }).click();
    await sentNote();
    await ui.nav("Activity");
    for (const label of ["Waiting for approval: Send note to Priya", "You approved: Send note to Priya", "Done: Send note to Priya"]) {
      await visible(ui.page.getByRole("button", { name: new RegExp(label) }));
    }
  });

  it(`refuses a demo note without sending it and records the refusal in Activity (${demoApprovalBlocker})`, async () => {
    await demoAction();
    await ui.page.getByRole("button", { name: "Refuse", exact: true }).click();
    await visible(ui.page.getByText("No problem — I didn't send it.", { exact: true }));
    await ui.waitForIdle();
    await hidden(ui.page.getByRole("button", { name: "Allow once", exact: true }));
    expect(await ui.api<PendingAction[]>("/api/actions")).toMatchObject([{ status: "refused" }]);
    await ui.nav("Activity");
    await visible(ui.page.getByRole("button", { name: /You refused: Send note to Priya/ }));
    await hidden(ui.page.getByRole("button", { name: /Done: Send note to Priya/ }));
  });

  it("requires a hold for money, renders a UPI QR, and lets the user mark payment as paid", async () => {
    await openToday();
    await ui.sendFromToday("Order something from California Pizza");
    await visible(ui.page.getByText("You'll pay", { exact: true }));
    await enabled(ui.page.getByRole("button", { name: "Always allow", exact: true }), false);
    const hold = ui.page.getByRole("button", { name: /^Hold to approve ₹[\d,]+/ });
    await enabled(hold);
    await ui.waitForIdle();
    const approvals: string[] = [];
    ui.page.on("request", (request) => {
      if (request.method() === "POST" && /\/api\/actions\/[^/]+\/approve$/.test(request.url())) approvals.push(request.url());
    });
    await hold.click();
    // Wait longer than the hold threshold to catch a timer accidentally surviving pointer-up.
    await delay(850);
    expect(approvals).toEqual([]);
    await enabled(hold);
    expect(await ui.api<PendingAction[]>("/api/actions")).toMatchObject([{ status: "pending", involvesMoney: true }]);
    await hidden(ui.page.getByText("Scan to pay with any UPI app", { exact: true }));
    await holdToApprove(ui.page);
    await visible(ui.page.getByText("Scan to pay with any UPI app", { exact: true }));
    await enabled(ui.page.getByRole("button", { name: "Open UPI app", exact: true }));
    // The QR must contain actual SVG drawing content, not just its text label.
    const qr = ui.page.locator("main .bg-white svg");
    await visible(qr);
    expect(await qr.locator("path").count()).toBeGreaterThan(0);
    expect(approvals).toHaveLength(1);
    await ui.page.getByRole("button", { name: "I've paid", exact: true }).click();
    await visible(ui.page.getByPlaceholder("UPI reference / UTR (optional)"));
    await ui.page.getByRole("button", { name: "Confirm", exact: true }).click();
    await visible(ui.page.getByText("Marked as paid. Thanks!", { exact: true }));
    await hidden(ui.page.getByRole("button", { name: "Open UPI app", exact: true }));
  });

  it("blocks a pizza order above the ₹500 spending limit saved through Settings", async () => {
    await openToday();
    await ui.nav("Settings");
    await ui.page.getByRole("button", { name: "Approvals", exact: true }).click();
    await ui.page.getByRole("button", { name: "₹500", exact: true }).click();
    await ui.page.getByRole("button", { name: "Save limit", exact: true }).click();
    await expect.poll(async () => (await ui.api<AppState>("/api/state")).settings.spendCapInr).toBe(500);
    await ui.nav("Today");
    await ui.sendFromToday("Order something from California Pizza");
    await visible(ui.page.getByText(/This is above your ₹500 per-action limit\./));
    await enabled(ui.page.getByRole("button", { name: /^Hold to approve/ }), false);
    const actions = await ui.api<PendingAction[]>("/api/actions");
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ status: "pending", spendCapInr: 500 });
    expect(actions[0]!.amountInr).toBeGreaterThan(500);
  });

  it(`adds an Always allow rule for the demo note and revokes it through Approvals settings (${demoApprovalBlocker})`, async () => {
    await demoAction();
    await ui.page.getByRole("button", { name: "Always allow", exact: true }).click();
    await sentNote();
    const rules = await ui.api<ApprovalRule[]>("/api/approval-rules");
    expect(rules).toHaveLength(1);
    await ui.nav("Settings");
    await ui.page.getByRole("button", { name: "Approvals", exact: true }).click();
    await visible(ui.page.getByText(rules[0]!.label, { exact: true }));
    await ui.page.getByRole("button", { name: "Revoke", exact: true }).click();
    await visible(ui.page.getByRole("heading", { name: "Nothing runs without asking", exact: true }));
    await hidden(ui.page.getByText(rules[0]!.label, { exact: true }));
    expect(await ui.api("/api/approval-rules")).toEqual([]);
  });

  it("keeps saved extra keys out of HTML and state, and clears Model inputs after reload", async () => {
    await openToday();
    const secret = "exa-test-secret-123456";
    await ui.api("/api/keys/exa", "PUT", { value: secret });
    expect(await ui.api("/api/keys")).toMatchObject({ exa: true });
    const state = JSON.stringify(await ui.api("/api/state"));
    expect(state).not.toMatch(/"apiKey"\s*:/);
    expect(state).not.toContain(secret);
    await ui.nav("Settings");
    await ui.page.getByRole("button", { name: "Model", exact: true }).click();
    await ui.page.getByRole("button", { name: "Anthropic API key", exact: true }).click();
    await ui.page.getByPlaceholder("sk-ant-…").fill("unsaved-test-key");
    await ui.page.reload();
    await visible(ui.page.getByRole("heading", { name: "Model", exact: true }));
    await ui.page.getByRole("button", { name: "Anthropic API key", exact: true }).click();
    await visible(ui.page.getByPlaceholder("sk-ant-…"));
    expect(await ui.page.locator("main input").evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toEqual([""]);
    expect(await ui.page.content()).not.toContain(secret);
    expect(await ui.page.content()).not.toContain("unsaved-test-key");
    await ui.nav("Connections");
    const exaRow = ui.page.locator("div").filter({ has: ui.page.getByText("Exa (web research)", { exact: true }) }).filter({ has: ui.page.getByRole("button", { name: "Replace", exact: true }) }).last();
    await exaRow.getByRole("button", { name: "Replace", exact: true }).click();
    const dialog = ui.page.getByRole("dialog", { name: "Exa (web research)", exact: true });
    await visible(dialog);
    expect(await dialog.locator("input").inputValue()).toBe("");
    expect(await ui.page.content()).not.toContain(secret);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await ui.nav("Activity");
    await visible(ui.page.getByRole("button", { name: /exa key saved/ }));
    expect(await ui.page.content()).not.toContain(secret);
  });

  it("persists the Recent conversation and its messages after core restarts with the same directory and key", async () => {
    await openToday();
    const message = "Remember this persistence check";
    await ui.sendFromToday(message);
    await visible(ui.page.getByText(/I'm running in demo mode \(no model connected\)/));
    await ui.waitForIdle();
    const messages = await ui.persistedMessages();
    expect(messages.some((m) => m.role === "user")).toBe(true);
    expect(messages.some((m) => m.role === "assistant")).toBe(true);
    await ui.restartCore();
    await ui.page.reload();
    await visible(ui.page.locator("aside").getByText("Recent", { exact: true }));
    await visible(ui.page.locator("aside").getByRole("button", { name: message, exact: true }));
    await ui.nav("Today");
    await ui.page.locator("aside").getByRole("button", { name: message, exact: true }).click();
    await visible(ui.page.locator("main").getByText(message, { exact: true }).last());
    await visible(ui.page.getByText(/I'm running in demo mode \(no model connected\)/));
    expect(await ui.persistedMessages()).toEqual(messages);
  });

  it("sorts the demo inbox into Needs you tasks and a collapsible Can wait group", async () => {
    await openToday();
    await ui.nav("Connections");
    await ui.page.getByRole("button", { name: "Try a demo inbox", exact: true }).click();
    await visible(ui.page.getByText("Connected", { exact: true }).first());
    await ui.nav("Tasks");
    const needsYou = ui.page.locator("section").filter({ has: ui.page.getByRole("heading", { name: "Needs you", exact: true }) });
    await visible(needsYou.getByRole("button", { name: "Handle it", exact: true }).first());
    const canWait = needsYou.getByRole("button", { name: /^Can wait · [1-9]/ });
    await visible(canWait);
    const data = await ui.api<{ items: { subject: string }[] }>("/api/google/can-wait");
    expect(data.items.length).toBeGreaterThan(0);
    const subject = needsYou.getByText(data.items[0]!.subject, { exact: true });
    await hidden(subject);
    await canWait.click();
    await visible(subject);
    await canWait.click();
    await hidden(subject);
  });

  it("creates a Monday routine, toggles it off and on, then deletes it", async () => {
    await openToday();
    await ui.nav("Routines");
    await ui.page.getByRole("button", { name: "New routine", exact: true }).click();
    const dialog = ui.page.getByRole("dialog", { name: "New routine", exact: true });
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Monday test brief");
    await dialog.getByRole("textbox", { name: /What should RelayIt do/ }).fill("Summarise the week ahead.");
    await dialog.getByRole("button", { name: "Every Monday at 9:00", exact: true }).click();
    await dialog.getByRole("button", { name: "Save routine", exact: true }).click();
    await hidden(dialog);
    await visible(ui.page.getByRole("button", { name: /^Monday test brief Every Monday at 9:00/ }));
    const toggle = ui.page.getByRole("switch", { name: "Enable Monday test brief", exact: true });
    await expect.poll(() => toggle.getAttribute("aria-checked")).toBe("true");
    await toggle.click();
    await expect.poll(() => toggle.getAttribute("aria-checked")).toBe("false");
    await toggle.click();
    await expect.poll(() => toggle.getAttribute("aria-checked")).toBe("true");
    await ui.page.reload();
    await expect.poll(() => toggle.getAttribute("aria-checked")).toBe("true");
    await ui.page.getByRole("button", { name: "Delete", exact: true }).click();
    await hidden(toggle);
    await visible(ui.page.getByRole("heading", { name: "No routines yet", exact: true }));
    expect(await ui.api("/api/routines")).toEqual([]);
  });

  it("renders dark backgrounds on both Today and Chat", async () => {
    await ui.page.emulateMedia({ colorScheme: "dark" });
    await openToday();
    async function assertDark(): Promise<void> {
      const background = await ui.page.locator("html").evaluate((html) => getComputedStyle(html).backgroundColor);
      const components = background.match(/[\d.]+/g)?.map(Number);
      expect(components, `Expected an opaque RGB background, got ${background}`).toBeDefined();
      const [r, g, b, alpha = 1] = components!;
      expect(alpha).toBe(1);
      const linear = [r!, g!, b!].map((c) => c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
      const luminance = 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
      expect(luminance, background).toBeLessThan(0.2);
    }
    await assertDark();
    await ui.page.getByRole("button", { name: "New chat", exact: true }).click();
    await visible(ui.page.getByRole("heading", { name: "What should we get done?", exact: true }));
    await assertDark();
  });
});
