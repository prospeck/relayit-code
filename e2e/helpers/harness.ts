import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { App, StaticKeyProvider, loadPlugins, startServer } from "@relayit/core";
import type { AppState, Conversation, Message, OnboardingRequest } from "@relayit/shared";
import type { Browser, BrowserContext, Page, WebSocket } from "playwright-core";
import { createServer, type ViteDevServer } from "vite";
import { expect } from "vitest";
import { visible } from "./browser.ts";
import { isCoreRestartNetworkError } from "./console-errors.ts";

const desktopRoot = fileURLToPath(new URL("../../apps/desktop/", import.meta.url));

export class UiHarness {
  private readonly suiteDir: string;
  private readonly browser: Browser;
  private restartingCore = false;
  dataDir: string;
  key = randomBytes(32);
  readonly consoleErrors: string[] = [];
  readonly uncaughtErrors: string[] = [];
  app!: App;
  core!: Awaited<ReturnType<typeof startServer>>;
  vite?: ViteDevServer;
  context?: BrowserContext;
  page!: Page;
  coreUrl = "";
  uiUrl = "";

  private constructor(suiteDir: string, browser: Browser) {
    this.suiteDir = suiteDir;
    this.browser = browser;
    this.dataDir = join(suiteDir, "core-initial");
  }

  static async start(browser: Browser): Promise<UiHarness> {
    const harness = new UiHarness(await mkdtemp(join(tmpdir(), "relayit-ui-")), browser);
    try {
      await harness.startCore();
      const previousUrl = process.env.VITE_CORE_URL;
      const previousToken = process.env.VITE_CORE_TOKEN;
      process.env.VITE_CORE_URL = harness.coreUrl;
      process.env.VITE_CORE_TOKEN = "e2e";
      try {
        harness.vite = await createServer({
          root: desktopRoot,
          cacheDir: join(harness.suiteDir, "vite-cache"),
          define: {
            "import.meta.env.VITE_CORE_URL": JSON.stringify(harness.coreUrl),
            "import.meta.env.VITE_CORE_TOKEN": JSON.stringify("e2e"),
          },
          server: { host: "127.0.0.1", port: 0, strictPort: false, open: false },
        });
        await harness.vite.listen();
      } finally {
        if (previousUrl === undefined) delete process.env.VITE_CORE_URL;
        else process.env.VITE_CORE_URL = previousUrl;
        if (previousToken === undefined) delete process.env.VITE_CORE_TOKEN;
        else process.env.VITE_CORE_TOKEN = previousToken;
      }
      const address = harness.vite.httpServer!.address();
      if (!address || typeof address === "string") throw new Error("Vite did not bind a TCP port");
      harness.uiUrl = `http://127.0.0.1:${address.port}`;
      await harness.newContext();
      // Finish the cold Vite compilation in setup, before a test starts clicking through onboarding.
      await harness.open();
      await expect
        .poll(() => harness.page.getByPlaceholder("Your first name").isVisible(), {
          timeout: 20_000,
        })
        .toBe(true);
      return harness;
    } catch (error) {
      await harness.close();
      throw error;
    }
  }

  private async newContext(): Promise<void> {
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 820 },
      colorScheme: "light",
    });
    // Suppress the automatic daily brief without changing the UI flow under test.
    await this.context.addInitScript(() => {
      if (location.protocol === "http:")
        localStorage.setItem("relayit.lastBrief", new Date().toDateString());
    });
    this.context.on("page", (page) => {
      page.on("console", (message) => {
        if (message.type() === "error") {
          if (
            this.restartingCore &&
            message.args().length === 0 &&
            isCoreRestartNetworkError(message.text(), message.location().url, this.coreUrl)
          )
            return;
          this.consoleErrors.push(message.text());
        }
      });
      page.on("pageerror", (error) => this.uncaughtErrors.push(error.message));
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(5_000);
  }

  async reset(): Promise<void> {
    await this.context?.close();
    await this.waitForIdle();
    const port = this.core.port;
    await this.core.close();
    await this.app.stop();
    await rm(this.dataDir, { recursive: true, force: true });
    this.dataDir = await mkdtemp(join(this.suiteDir, "core-"));
    this.key = randomBytes(32);
    this.consoleErrors.length = 0;
    this.uncaughtErrors.length = 0;
    // Share the Vite server, but replace core storage, the encryption key and browser context for every test.
    await this.startCore(port);
    await this.newContext();
  }

  private async startCore(port = 0): Promise<void> {
    this.app = new App({
      dataDir: this.dataDir,
      keyProvider: new StaticKeyProvider(this.key),
      mockModel: true,
      fakeGoogleUrl: null,
    });
    await this.app.start();
    const modules = await loadPlugins(this.app);
    this.core = await startServer(this.app, { port, token: "e2e", modules });
    this.coreUrl = `http://127.0.0.1:${this.core.port}`;
    // Plugins connect in the background. Wait for both built-in subprocesses before using them or stopping core.
    await expect
      .poll(
        async () => {
          const servers = await this.api<{ id: string; status: string }[]>("/api/mcp/servers");
          return ["builtin-food", "builtin-travel"].every((id) =>
            servers.some((s) => s.id === id && s.status === "connected"),
          );
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    await this.api("/api/settings", "PATCH", {
      briefOnFirstOpen: false,
      notifications: false,
      briefTime: "23:59",
    });
  }

  async api<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(`${this.coreUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(5_000),
      headers: { authorization: "Bearer e2e", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}`);
    return (await response.json()) as T;
  }

  async onboard(name = "Asha"): Promise<AppState> {
    const request: OnboardingRequest = {
      profile: {
        name,
        city: "Pune",
        addresses: [
          { id: "home", label: "Home", line: "1 Test Street", city: "Pune", pincode: "" },
        ],
      },
      model: { provider: "ollama", model: "mock" },
    };
    return this.api<AppState>("/api/onboarding", "POST", request);
  }

  async open(): Promise<void> {
    let connected = false;
    const onSocket = (socket: WebSocket) => {
      if (new URL(socket.url()).pathname === "/api/events")
        socket.on("framereceived", () => {
          connected = true;
        });
    };
    this.page.on("websocket", onSocket);
    try {
      await this.page.goto(this.uiUrl, { waitUntil: "commit" });
      // Greeting data can arrive before the event stream. Subscribe before sending a fast mock response.
      await expect.poll(() => connected, { timeout: 20_000 }).toBe(true);
      await this.page.waitForLoadState("networkidle", { timeout: 20_000 });
    } finally {
      this.page.off("websocket", onSocket);
    }
  }

  async nav(name: string): Promise<void> {
    await this.page.locator("aside").getByRole("button", { name, exact: true }).click();
  }

  async sendFromToday(text: string): Promise<void> {
    const composer = this.page.getByPlaceholder(
      "Say it once… “Order something from California Pizza”",
    );
    await composer.fill(text);
    await composer.press("Enter");
    await expect.poll(() => this.page.url()).toMatch(/#\/chat\//);
    await visible(this.page.getByRole("heading", { name: text, exact: true }));
  }

  async waitForIdle(): Promise<void> {
    const deadline = Date.now() + 5_000;
    do {
      const conversations = await this.api<Conversation[]>("/api/conversations");
      const details = await Promise.all(
        conversations.map((c) => this.api<{ busy: boolean }>(`/api/conversations/${c.id}`)),
      );
      if (details.every((d) => !d.busy)) return;
      await delay(25);
    } while (Date.now() < deadline);
    throw new Error("Core still has an active agent run after 5 seconds");
  }

  async restartCore(): Promise<void> {
    await this.waitForIdle();
    const port = this.core.port;
    this.restartingCore = true;
    try {
      await this.core.close();
      await this.app.stop();
      // Keep the same endpoint so reload exercises persisted state, without changing Vite's configuration.
      await this.startCore(port);
    } finally {
      this.restartingCore = false;
    }
  }

  async persistedMessages(): Promise<Message[]> {
    const id = this.page.url().split("#/chat/")[1];
    if (!id) throw new Error("Expected an open conversation");
    return (await this.api<{ messages: Message[] }>(`/api/conversations/${id}`)).messages;
  }

  async close(): Promise<void> {
    try {
      await this.context?.close();
    } finally {
      try {
        await this.vite?.close();
      } finally {
        try {
          try {
            if (this.coreUrl) await this.waitForIdle();
          } finally {
            await this.core?.close();
          }
        } finally {
          try {
            await this.app?.stop();
          } finally {
            await rm(this.suiteDir, { recursive: true, force: true });
          }
        }
      }
    }
  }
}

export async function holdToApprove(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: /^Hold to approve/ });
  await button.hover();
  const box = await button.boundingBox();
  if (!box) throw new Error("Hold-to-approve button has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await delay(1_000);
  } finally {
    await page.mouse.up();
  }
}
