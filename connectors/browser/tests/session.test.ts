import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import type { BrowserContext, Page } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserSession } from "../src/session.ts";

const directories: string[] = [];
async function profileDir() {
  const path = await mkdtemp(join(tmpdir(), "relayit-session-test-"));
  directories.push(path);
  return path;
}
function contextResource() {
  let closed = false;
  const page = { isClosed: () => closed } as Page;
  const events = new EventEmitter();
  const context = Object.assign(events, {
    pages: () => [page],
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    async close() {
      closed = true;
      events.emit("close");
    },
  });
  return { context: context as unknown as BrowserContext, page, closed: () => closed };
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("session lifecycle without a browser binary", () => {
  it("lazily falls back Chrome → Edge → bundled and reuses the same context for concurrent callers", async () => {
    const resource = contextResource();
    const attempts: unknown[] = [];
    vi.spyOn(chromium, "launchPersistentContext").mockImplementation(async (_path, options) => {
      attempts.push(options?.channel);
      if (options?.channel) throw new Error("not installed");
      return resource.context;
    });
    const session = new BrowserSession({ profileDir: await profileDir(), headless: true });
    expect(attempts).toEqual([]);
    const pages = await Promise.all([session.getPage(), session.getPage()]);
    expect(attempts).toEqual(["chrome", "msedge", undefined]);
    expect(pages).toEqual([resource.page, resource.page]);
    await session.close();
    expect(resource.closed()).toBe(true);
  });
  it("closes the context after ten idle minutes and resets the timer on use", async () => {
    const resource = contextResource();
    vi.spyOn(chromium, "launchPersistentContext").mockResolvedValue(resource.context);
    const session = new BrowserSession({ profileDir: await profileDir(), headless: true });
    vi.useFakeTimers();
    await session.getPage();
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    await session.getPage();
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(resource.closed()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(resource.closed()).toBe(true);
    await session.close();
  });
  it("gives an install instruction when none of the three browsers launches", async () => {
    vi.spyOn(chromium, "launchPersistentContext").mockRejectedValue(new Error("not installed"));
    const session = new BrowserSession({ profileDir: await profileDir() });
    await expect(session.getPage()).rejects.toThrow(
      "Install Google Chrome to use the browser agent",
    );
    await session.close();
  });
});
