import { chromium, type Browser, type Locator } from "playwright-core";
import { expect } from "vitest";

export async function launchChrome(): Promise<{
  browser: Browser | null;
  skipReason: string | null;
}> {
  try {
    return {
      browser: await chromium.launch({ channel: "chrome", headless: true }),
      skipReason: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/distribution 'chrome' is not found|Executable doesn't exist/i.test(message)) throw error;
    return {
      browser: null,
      skipReason: "Google Chrome is missing; install Chrome to run the desktop UI suites.",
    };
  }
}

export async function visible(locator: Locator): Promise<void> {
  await expect
    .poll(() => locator.isVisible(), { message: `Expected ${locator} to be visible` })
    .toBe(true);
}

export async function hidden(locator: Locator): Promise<void> {
  await expect.poll(() => locator.count()).toBe(0);
}

export async function enabled(locator: Locator, value = true): Promise<void> {
  await visible(locator);
  await expect.poll(() => locator.isEnabled()).toBe(value);
}
