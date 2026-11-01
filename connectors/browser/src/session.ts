import { mkdir } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { chromium } from "playwright-core";
import type { BrowserContext, Page } from "playwright-core";

export type BrowserFrame = { url: string; jpegBase64: string };
export type BrowserSessionOptions = {
  /** A dedicated RelayIt profile, never the user's normal Chrome profile. */
  profileDir: string;
  headless?: boolean;
  /** Optional explicit choice; chromium uses only the locally bundled browser. */
  channel?: "chrome" | "msedge" | "chromium";
};

export class BrowserSession {
  private options: BrowserSessionOptions;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private starting: Promise<BrowserContext> | null = null;
  private closing: Promise<void> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  private frameCallbacks = new Set<(frame: BrowserFrame) => void>();
  private lastFrameAt = 0;
  private capturing: Promise<void> | null = null;

  constructor(options: BrowserSessionOptions) {
    if (!isAbsolute(options.profileDir))
      throw new Error("Use an absolute path for the dedicated Chromium profile directory");
    this.options = { ...options, headless: options.headless ?? false };
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      void this.close().catch(() => {});
    }, 10 * 60_000);
    this.idleTimer.unref();
  }

  private async start(): Promise<BrowserContext> {
    await mkdir(this.options.profileDir, { recursive: true, mode: 0o700 });
    const channels = this.options.channel
      ? [this.options.channel]
      : (["chrome", "msedge", "chromium"] as const);
    for (const channel of channels) {
      let context: BrowserContext;
      try {
        context = await chromium.launchPersistentContext(this.options.profileDir, {
          channel: channel === "chromium" ? undefined : channel,
          headless: this.options.headless,
          viewport: { width: 1280, height: 860 },
          timeout: 10_000,
        });
      } catch {
        continue;
      }
      context.setDefaultTimeout(8000);
      context.setDefaultNavigationTimeout(12_000);
      this.context = context;
      this.page = context.pages()[0] ?? (await context.newPage());
      context.on("page", (page) => {
        this.page = page;
        this.touch();
      });
      context.on("close", () => {
        if (this.context !== context) return;
        this.context = null;
        this.page = null;
        if (this.idleTimer) clearTimeout(this.idleTimer);
        if (this.frameTimer) clearTimeout(this.frameTimer);
      });
      this.touch();
      return context;
    }
    throw new Error(
      "Install Google Chrome to use the browser agent. Chrome, Microsoft Edge and locally bundled Chromium could not launch. Close other windows using the dedicated RelayIt profile and try again.",
    );
  }

  async getPage(): Promise<Page> {
    if (this.closing) await this.closing;
    if (!this.context) {
      this.starting ??= this.start();
      try {
        await this.starting;
      } finally {
        this.starting = null;
      }
    }
    this.touch();
    if (!this.page || this.page.isClosed()) {
      this.page =
        this.context!.pages().find((page) => !page.isClosed()) ?? (await this.context!.newPage());
    }
    return this.page;
  }

  onFrame(callback: (frame: BrowserFrame) => void): () => void {
    this.frameCallbacks.add(callback);
    return () => {
      this.frameCallbacks.delete(callback);
    };
  }

  private async captureFrame(): Promise<void> {
    const page = this.page;
    if (!page || page.isClosed() || !this.frameCallbacks.size) return;
    try {
      const cdp = await page.context().newCDPSession(page);
      try {
        const size = page.viewportSize() ?? { width: 1280, height: 860 };
        const result = await cdp.send("Page.captureScreenshot", {
          format: "jpeg",
          quality: 55,
          captureBeyondViewport: false,
          clip: {
            x: 0,
            y: 0,
            width: size.width,
            height: size.height,
            scale: Math.min(1, 900 / size.width),
          },
        });
        const frame = { url: page.url(), jpegBase64: result.data };
        this.lastFrameAt = Date.now();
        for (const callback of this.frameCallbacks) {
          try {
            callback(frame);
          } catch {
            /* UI listeners must not break a browser action. */
          }
        }
      } finally {
        await cdp.detach().catch(() => {});
      }
    } catch {
      /* A navigation or closed tab can race a live peek. */
    }
  }

  /** Emit after an action. Coalesce rapid actions, always keeping the latest view. */
  async afterAction(): Promise<void> {
    this.touch();
    if (!this.frameCallbacks.size) return;
    if (this.capturing) await this.capturing;
    const delay = 400 - (Date.now() - this.lastFrameAt);
    if (this.frameTimer) clearTimeout(this.frameTimer);
    if (delay > 0) {
      this.frameTimer = setTimeout(() => {
        this.frameTimer = null;
        this.capturing = this.captureFrame();
        void this.capturing.finally(() => {
          this.capturing = null;
        });
      }, delay);
      this.frameTimer.unref();
    } else {
      this.capturing = this.captureFrame();
      try {
        await this.capturing;
      } finally {
        this.capturing = null;
      }
    }
  }

  async bringToFront(): Promise<void> {
    if (!this.options.headless) await (await this.getPage()).bringToFront();
  }

  /** Sign-in must be visible even when normal agent browsing is headless. */
  async show(): Promise<Page> {
    if (this.options.headless) {
      await this.close();
      this.options.headless = false;
    }
    const page = await this.getPage();
    await this.bringToFront();
    return page;
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      if (this.starting) await this.starting.catch(() => {});
      if (this.idleTimer) clearTimeout(this.idleTimer);
      if (this.frameTimer) clearTimeout(this.frameTimer);
      this.idleTimer = null;
      this.frameTimer = null;
      if (this.capturing) await this.capturing;
      const context = this.context;
      this.context = null;
      this.page = null;
      await context?.close();
    })();
    try {
      await this.closing;
    } finally {
      this.closing = null;
    }
  }
}
