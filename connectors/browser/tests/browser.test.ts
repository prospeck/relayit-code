import { mkdtemp, rm } from "node:fs/promises";
import type { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext, ToolDef } from "@relayit/shared";
import { BrowserSession, createBrowserTools, snapshot } from "../src/index.ts";
import { startShop } from "./fixtures/shop/server.ts";

// Windows runners use installed Edge for both probing and the throwaway persistent profile.
// On macOS, keep bundled Chromium first, then system Chrome. Never download a browser.
const launchChannel =
  process.platform === "win32"
    ? await chromium.launch({ headless: true, channel: "msedge" }).then(async (browser) => {
        await browser.close();
        return "msedge" as const;
      })
    : await chromium
        .launch({ headless: true })
        .then(async (browser) => {
          await browser.close();
          return "chromium" as const;
        })
        .catch(() =>
          chromium.launch({ headless: true, channel: "chrome" }).then(async (browser) => {
            await browser.close();
            return "chrome" as const;
          }),
        )
        .catch(() => null);
const browserAvailable = launchChannel !== null;

describe("offline browser connector", () => {
  let shop: Awaited<ReturnType<typeof startShop>>;
  let profile: string;
  let session: BrowserSession;
  let tools: ToolDef[];
  let ctx: ToolContext;
  beforeAll(async () => {
    shop = await startShop();
  });
  afterAll(async () => {
    await shop.close();
  });
  beforeEach(async () => {
    if (!browserAvailable) return;
    // CPU stress can delay Chrome's launch handshake beyond the production 10-second budget.
    const launch = chromium.launchPersistentContext.bind(chromium);
    vi.spyOn(chromium, "launchPersistentContext").mockImplementation((directory, options) =>
      launch(directory, { ...options, timeout: 30_000 }),
    );
    profile = await mkdtemp(join(tmpdir(), "relayit-browser-test-"));
    session = new BrowserSession({
      profileDir: profile,
      headless: true,
      channel: launchChannel ?? "chromium",
    });
    tools = createBrowserTools({ getSession: async () => session, isEnabled: async () => true });
    const data = new Map<string, unknown>();
    ctx = {
      conversationId: "test",
      runId: "run",
      signal: new AbortController().signal,
      idempotencyKey: "submit-1",
      profile: null,
      memory: [],
      status() {},
      secrets: { get: async () => null, set: async () => {}, delete: async () => {} },
      kv: {
        get: async <T>(key: string) => (data.get(key) as T | undefined) ?? null,
        set: async (key, value) => {
          data.set(key, value);
        },
      },
    };
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (!browserAvailable) return;
    await session.close();
    await rm(profile, { recursive: true, force: true });
  });
  const tool = (name: string) => tools.find((tool) => tool.name === name)!;
  const run = (name: string, input: unknown = {}) => {
    const t = tool(name);
    return t.run(t.input.parse(input), ctx);
  };
  const open = (path: string) => run("browser_open", { url: shop.url + path });
  const ref = async (selector: string) =>
    (await session.getPage()).locator(selector).first().getAttribute("data-relayit-ref");

  it.skipIf(!browserAvailable)(
    "numbers visible controls, caps snapshots, and marks/redacts sensitive fields",
    async () => {
      const result = await open("/");
      expect(result.text).toMatch(/\[\d+\] textbox "Search for restaurants"/);
      expect(result.text).toContain('link "Test Kitchen"');
      expect(result.text).not.toMatch(/Invisible|Far away/);
      const page = await session.getPage();
      const refs = await page
        .locator("[data-relayit-ref]")
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("data-relayit-ref")),
        );
      expect(new Set(refs).size).toBe(refs.length);
      await open("/login");
      const login = await snapshot(page);
      expect(login.text).toContain("sensitive — user must fill");
      expect(login.text).not.toMatch(/synthetic-password|123456/);
      expect(login.text).not.toContain('"1234"');
      expect((await run("browser_extract")).text).not.toMatch(/synthetic-password|123456|1234/);
      await page.locator("body").evaluate((body) => {
        for (let index = 0; index < 100; index++) {
          const paragraph = document.createElement("p");
          paragraph.style.margin = "0";
          paragraph.style.fontSize = "1px";
          paragraph.style.lineHeight = "1px";
          paragraph.textContent = `Block ${index}: ${"long text ".repeat(25)}`;
          body.append(paragraph);
        }
      });
      expect((await snapshot(page)).text.length).toBe(6000);
    },
  );
  it.skipIf(!browserAvailable)(
    "refuses sensitive typing and selection without modifying fields",
    async () => {
      for (const [path, selector] of [
        ["/login", "input"],
        ["/payment", "input"],
      ]) {
        await open(path!);
        for (const input of await (await session.getPage()).locator(selector!).all()) {
          const before = await input.inputValue();
          const result = await run("browser_type", {
            ref: await input.getAttribute("data-relayit-ref"),
            text: "unsafe",
          });
          expect(result.message).toMatch(/user.*visible browser/i);
          expect(await input.inputValue()).toBe(before);
        }
      }
      await open("/login");
      expect(
        (await run("browser_select", { ref: await ref("select"), option: "1234" })).message,
      ).toMatch(/user.*visible browser/i);
    },
  );
  it.skipIf(!browserAvailable)("blocks commit clicks and implicit Enter submission", async () => {
    await open("/cart");
    for (const button of await (await session.getPage()).locator("button").all()) {
      const result = await run("browser_click", {
        ref: await button.getAttribute("data-relayit-ref"),
      });
      expect(result.message).toContain("browser_submit");
    }
    const note = await ref("input");
    const result = await run("browser_type", {
      ref: note,
      text: "Leave at door",
      pressEnter: true,
    });
    expect(result.message).toContain("browser_submit");
    expect(await (await session.getPage()).locator("input").inputValue()).toBe("");
  });
  it.skipIf(!browserAvailable)(
    "rejects stale refs rather than clicking another control after a snapshot",
    async () => {
      await open("/menu");
      const oldRef = await ref("button");
      await run("browser_snapshot");
      await expect(run("browser_click", { ref: oldRef })).rejects.toThrow();
      expect(await (await session.getPage()).locator("button").innerText()).toBe("ADD");
    },
  );
  it.skipIf(!browserAvailable)(
    "settles actions and later navigation while background requests and favicons never finish",
    async () => {
      const background = await startShop();
      try {
        await open("/menu");
        const page = await session.getPage();
        await page.locator("button").evaluate((button, backgroundUrl) => {
          button.onclick = () => {
            void fetch(backgroundUrl + "/hang", { mode: "no-cors" });
            const icon = document.createElement("link");
            icon.rel = "icon";
            icon.href = "/favicon.ico";
            document.head.append(icon);
            const image = new Image();
            image.src = "/hang";
            document.body.append(image);
            button.textContent = "Added";
          };
        }, background.url);
        const listeners = [
          "request",
          "requestfinished",
          "requestfailed",
          "framenavigated",
        ] as const;
        const events = page as unknown as EventEmitter;
        const before = listeners.map((event) => events.listenerCount(event));
        const [result] = await Promise.all([
          run("browser_submit", { ref: await ref("button") }),
          page.waitForRequest(background.url + "/hang"),
          page.waitForRequest(shop.url + "/hang"),
        ]);
        expect(result).toMatchObject({ submitted: true, text: expect.stringContaining("Added") });
        expect(background.hanging()).toBeGreaterThan(0);
        expect(shop.hanging()).toBeGreaterThan(0);
        expect(listeners.map((event) => events.listenerCount(event))).toEqual(before);
        expect(await open("/login")).toMatchObject({ url: shop.url + "/login" });
        expect(await open("/menu")).toMatchObject({ url: shop.url + "/menu" });
      } finally {
        await background.close();
      }
    },
  );
  it.skipIf(!browserAvailable)(
    "previews page-derived facts and flags money without trusting model totals",
    async () => {
      await open("/cart");
      const submit = tool("browser_submit");
      const input = submit.input.parse({
        ref: await ref("button"),
        expectedTotalInr: 120,
        summary: "Dal rice",
      });
      const preview = await submit.preview!(input, ctx);
      expect(submit.service).toBe("127.0.0.1");
      expect(preview).toMatchObject({
        title: "Proceed to Pay",
        service: "127.0.0.1",
        amountInr: 120,
      });
      expect(preview.details).toEqual(
        expect.arrayContaining([
          { label: "Page", value: "Fixture Shop" },
          {
            label: "RelayIt read this on the page — check it",
            value: "Dal rice; expected total ₹120",
          },
        ]),
      );
      expect(typeof submit.involvesMoney === "function" && submit.involvesMoney(input)).toBe(true);
      const noTotal = await submit.preview!(submit.input.parse({ ref: await ref("button") }), ctx);
      expect(noTotal.amountInr).toBeNull();
      const payInput = submit.input.parse({ ref: await ref("button") });
      await submit.preview!(payInput, ctx);
      expect(typeof submit.involvesMoney === "function" && submit.involvesMoney(payInput)).toBe(
        true,
      );
    },
  );
  it.skipIf(!browserAvailable)("hands payment clicks and submits to the user", async () => {
    await open("/payment");
    const before = shop.clicks();
    for (const name of ["browser_click", "browser_submit"]) {
      expect(await run(name, { ref: await ref("button") })).toEqual({
        handoff: true,
        message: "Payment step reached — hand off to the user",
      });
    }
    expect(shop.clicks()).toBe(before);
  });
  it.skipIf(!browserAvailable)(
    "deduplicates sequential and concurrent approved submits in KV across tool factories",
    async () => {
      await open("/cart");
      const input = { ref: await ref("button") };
      const before = shop.clicks();
      const page = await session.getPage();
      let release!: () => void;
      let started!: () => void;
      const response = new Promise<void>((resolve) => (release = resolve));
      const request = new Promise<void>((resolve) => (started = resolve));
      await page.route("**/commit", async (route) => {
        started();
        await response;
        await route.continue();
      });
      const initial = run("browser_submit", input);
      await request;
      const duplicate = run("browser_submit", input);
      tools = createBrowserTools({ getSession: async () => session, isEnabled: async () => true });
      const otherFactory = run("browser_submit", input);
      release();
      const [first, concurrent, acrossFactories] = await Promise.all([
        initial,
        duplicate,
        otherFactory,
      ]);
      expect(first).toMatchObject({ submitted: true, handoff: true, url: shop.url + "/payment" });
      expect(concurrent).toEqual(first);
      expect(acrossFactories).toEqual(first);
      expect(await ctx.kv.get(`browser.submit.${ctx.idempotencyKey}`)).toEqual({
        state: "done",
        result: first,
      });
      tools = createBrowserTools({ getSession: async () => session, isEnabled: async () => true });
      expect(await run("browser_submit", input)).toEqual(first);
      expect(shop.clicks()).toBe(before + 1);
    },
  );
  it.skipIf(!browserAvailable)(
    "keeps an unsettled submit uncertain instead of caching an old page as success",
    async () => {
      await open("/cart");
      const input = { ref: await ref("button") };
      const page = await session.getPage();
      const before = shop.clicks();
      const error = new Error("submit navigation has not settled");
      vi.spyOn(page, "waitForLoadState").mockRejectedValue(error);
      await expect(run("browser_submit", input)).rejects.toBe(error);
      expect(await ctx.kv.get(`browser.submit.${ctx.idempotencyKey}`)).toEqual({
        state: "pending",
      });
      expect(await run("browser_submit", input)).toMatchObject({ handoff: true });
      await page.waitForURL(shop.url + "/payment");
      expect(shop.clicks()).toBe(before + 1);
    },
  );
  it.skipIf(!browserAvailable)("recovers a snapshot across a document replacement", async () => {
    await open("/payment");
    const page = await session.getPage();
    const evaluate = page.evaluate.bind(page);
    vi.spyOn(page, "evaluate").mockImplementationOnce(() =>
      evaluate(
        () =>
          new Promise<never>(() => {
            location.reload();
          }),
      ),
    );
    expect(await run("browser_snapshot")).toMatchObject({
      url: shop.url + "/payment",
      text: expect.stringContaining("Heading: Payment"),
    });
  });
  it.skipIf(!browserAvailable)(
    "supports navigation, preparation, extraction, back, and throttled JPEG frames",
    async () => {
      const frames: { jpegBase64: string; url: string }[] = [];
      session.onFrame((frame) => {
        frames.push(frame);
      });
      await open("/");
      await run("browser_type", { ref: await ref("input"), text: "dal" });
      await run("browser_click", { ref: await ref('a[href="/menu"]') });
      await run("browser_click", { ref: await ref("button") });
      expect((await run("browser_snapshot")).text).toContain("Added");
      await run("browser_select", { ref: await ref("select"), option: "large" });
      expect(await (await session.getPage()).locator("select").inputValue()).toBe("large");
      expect((await run("browser_extract", { ref: await ref("button") })).text).toBe("Added");
      await run("browser_scroll", { direction: "down", amount: 300 });
      await run("browser_back");
      expect((await session.getPage()).url()).toBe(shop.url + "/");
      expect(frames.length).toBeGreaterThan(0);
      expect(Buffer.from(frames[0]!.jpegBase64, "base64").subarray(0, 2)).toEqual(
        Buffer.from([0xff, 0xd8]),
      );
      const jpeg = Buffer.from(frames[0]!.jpegBase64, "base64");
      // Chromium decodes the emitted image so the cap is checked on the actual JPEG.
      const width = await (
        await session.getPage()
      ).evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/jpeg;base64,${base64}`;
        await image.decode();
        return image.width;
      }, jpeg.toString("base64"));
      expect(width).toBeLessThanOrEqual(900);
    },
  );
  it.skipIf(!browserAvailable)(
    "reuses one profile and preserves its login cookie after close/restart",
    async () => {
      const [first, second] = await Promise.all([session.getPage(), session.getPage()]);
      expect(first).toBe(second);
      await open("/");
      await first
        .context()
        .addCookies([
          { name: "fixture-login", value: "yes", url: shop.url, expires: Date.now() / 1000 + 3600 },
        ]);
      await session.close();
      const restarted = await session.getPage();
      expect(
        (await restarted.context().cookies(shop.url)).find(
          (cookie) => cookie.name === "fixture-login",
        )?.value,
      ).toBe("yes");
    },
  );
});
