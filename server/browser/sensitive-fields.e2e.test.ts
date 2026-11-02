import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROME } from "./cdp/testing/real-chrome.ts";
import { FixtureServer } from "./cdp/testing/fixtures.ts";
import { startService, type RealService } from "./testing/real-service.ts";
import { hostTimeout } from "../testing/host-timeout.ts";

(CHROME ? describe : describe.skip)("India service sensitive fields in real Chrome", () => {
  let fixture: FixtureServer;
  let real: RealService;
  const target = { session: "india-sensitive", key: "bot:india-sensitive" };
  beforeAll(async () => { fixture = await FixtureServer.start(); real = await startService(); }, hostTimeout(240_000));
  afterAll(async () => { await real?.close(); await fixture?.close(); });
  it("refuses fill, focused typing, keypresses and evaluation on secret forms, and permits direct human entry", async () => {
    const url = fixture.page("/login", `<!doctype html><title>Login fixture</title>
      <label>Enter code <input id="code"></label><input id="password" type="password"><input id="otp" autocomplete="one-time-code">
      <input id="card" aria-label="Card number"><input id="cvv" placeholder="CVV">
      <input id="upiPin" name="upiPin"><input id="PINCode" name="PINCode"><input id="name" aria-label="Delivery name">
      <button id="pay" onclick="document.title='PAID'">Place order</button>`);
    await real.call(target, "agent_browser_open", { url });
    for (const id of ["code", "password", "otp", "card", "cvv", "upiPin", "PINCode"]) {
      const filled = await real.call(target, "agent_browser_fill", { selector: `#${id}`, text: "fixture" });
      expect(filled.isError).toBe(true);
      expect(real.text(filled)).toContain("person to enter");
      await real.call(target, "agent_browser_click", { selector: `#${id}` });
      expect((await real.call(target, "agent_browser_type", { text: "fixture" })).isError).toBe(true);
      expect((await real.call(target, "agent_browser_press", { key: "1" })).isError).toBe(true);
    }
    expect((await real.call(target, "agent_browser_eval", { expression: "document.querySelector('#password').value='fixture'" })).isError).toBe(true);
    expect(await real.peek(target, `[...document.querySelectorAll("input")].every(field => field.value === "")`)).toBe(true);
    const tab = real.service.profiles().find((profile) => profile.key === target.key)!.active()!;
    await tab.page.fill({ selector: "#password" }, "human-fixture-entry");
    expect(await real.peek(target, `document.querySelector("#password").value`)).toBe("human-fixture-entry");
    expect(real.text(await real.call(target, "agent_browser_snapshot"))).not.toContain("human-fixture-entry");
    const normal = await real.call(target, "agent_browser_fill", { selector: "#name", text: "Demo person" });
    expect(normal.isError).not.toBe(true);
    expect(real.text(await real.call(target, "agent_browser_click", { selector: "#pay" }))).toContain("only the person presses");
    expect(real.text(await real.call(target, "agent_browser_snapshot"))).toContain("Login fixture");
  }, hostTimeout(45_000));
});
