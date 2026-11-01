import { EventEmitter } from "node:events";
import type { Page } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAfterNavigation, settleAfterAction } from "../src/navigation.ts";

const navigationError = new Error(
  "page.evaluate: Execution context was destroyed, most likely because of a navigation",
);
function pageResource() {
  const waitForLoadState = vi.fn().mockResolvedValue(undefined);
  const frame = {};
  const events = new EventEmitter();
  const page = Object.assign(events, {
    waitForLoadState,
    mainFrame: () => frame,
  }) as unknown as Page;
  const failDuringNavigation = async () => {
    events.emit("framenavigated", frame);
    throw navigationError;
  };
  return { page, events, frame, waitForLoadState, failDuringNavigation };
}

describe("settling an action", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits for action requests even when the old document is already loaded", async () => {
    const { page, events, frame, waitForLoadState } = pageResource();
    const request = { isNavigationRequest: () => false };
    let done = false;
    const result = settleAfterAction(page, async () => {
      events.emit("request", request);
    }).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(false);
    expect(waitForLoadState).not.toHaveBeenCalled();
    events.emit("requestfinished", request);
    events.emit("framenavigated", frame);
    await vi.advanceTimersByTimeAsync(500);
    await result;
    expect(waitForLoadState).toHaveBeenCalledWith("domcontentloaded", { timeout: 12_000 });
    expect(events.eventNames()).toEqual([]);
  });

  it("waits for follow-up requests and handles failed requests", async () => {
    const { page, events } = pageResource();
    const request = { isNavigationRequest: () => false };
    let done = false;
    const result = settleAfterAction(page, async () => {}).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(400);
    events.emit("request", request);
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(false);
    events.emit("requestfailed", request);
    await vi.advanceTimersByTimeAsync(500);
    await result;
    expect(events.eventNames()).toEqual([]);
  });

  it("drops abandoned fetches when a replacement document starts loading", async () => {
    const { page, events, frame } = pageResource();
    const fetch = { isNavigationRequest: () => false };
    const navigation = { isNavigationRequest: () => true, frame: () => frame };
    let done = false;
    const result = settleAfterAction(page, async () => {
      events.emit("request", fetch);
    }).then(() => (done = true));
    events.emit("request", navigation);
    events.emit("framenavigated", frame);
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(false);
    events.emit("requestfinished", navigation);
    await vi.advanceTimersByTimeAsync(500);
    await result;
    expect(events.eventNames()).toEqual([]);
  });

  it("bounds an unsettled action without repeating it or leaking listeners", async () => {
    const { page, events } = pageResource();
    const action = vi.fn(async () => {
      events.emit("request", { isNavigationRequest: () => false });
    });
    const result = expect(settleAfterAction(page, action)).rejects.toThrow(
      "Browser action did not settle within 12 seconds",
    );
    await vi.advanceTimersByTimeAsync(12_000);
    await result;
    expect(action).toHaveBeenCalledTimes(1);
    expect(events.eventNames()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates action failures and removes observers", async () => {
    const { page, events } = pageResource();
    const error = new Error("click failed");
    await expect(
      settleAfterAction(page, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(events.eventNames()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("reads during navigation", () => {
  it("waits for the replacement document and retries a destroyed context once", async () => {
    const { page, waitForLoadState, failDuringNavigation } = pageResource();
    const read = vi
      .fn()
      .mockImplementationOnce(failDuringNavigation)
      .mockImplementationOnce(async () => {
        expect(waitForLoadState).toHaveBeenCalledWith("domcontentloaded", { timeout: 4000 });
        return "new document";
      });
    expect(await readAfterNavigation(page, read)).toBe("new document");
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("propagates a second navigation error instead of retrying indefinitely", async () => {
    const { page, waitForLoadState, failDuringNavigation } = pageResource();
    const read = vi.fn().mockImplementation(failDuringNavigation);
    await expect(readAfterNavigation(page, read)).rejects.toBe(navigationError);
    expect(read).toHaveBeenCalledTimes(2);
    expect(waitForLoadState).toHaveBeenCalledTimes(1);
  });
  it("waits for main-frame commit rather than the old document's load state", async () => {
    const { page, events, frame, waitForLoadState } = pageResource();
    const read = vi
      .fn()
      .mockRejectedValueOnce(navigationError)
      .mockResolvedValueOnce("new document");
    const result = readAfterNavigation(page, read);
    await Promise.resolve();
    events.emit("framenavigated", {});
    expect(waitForLoadState).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    events.emit("framenavigated", frame);
    expect(await result).toBe("new document");
    expect(events.listenerCount("framenavigated")).toBe(0);
  });
  it("bounds the wait for a navigation commit and removes its listener", async () => {
    vi.useFakeTimers();
    try {
      const { page, events, waitForLoadState } = pageResource();
      const read = vi.fn().mockRejectedValue(navigationError);
      const result = expect(readAfterNavigation(page, read)).rejects.toThrow(
        "did not commit within 4 seconds",
      );
      await vi.advanceTimersByTimeAsync(4000);
      await result;
      expect(read).toHaveBeenCalledTimes(1);
      expect(waitForLoadState).not.toHaveBeenCalled();
      expect(events.listenerCount("framenavigated")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("propagates unrelated read errors without retrying", async () => {
    const { page, waitForLoadState } = pageResource();
    const error = new Error("Target page, context or browser has been closed");
    const read = vi.fn().mockRejectedValue(error);
    await expect(readAfterNavigation(page, read)).rejects.toBe(error);
    expect(read).toHaveBeenCalledTimes(1);
    expect(waitForLoadState).not.toHaveBeenCalled();
  });
  it("fails if the replacement document does not load within the bound", async () => {
    const { page, waitForLoadState, failDuringNavigation } = pageResource();
    const error = new Error("load timed out");
    waitForLoadState.mockRejectedValue(error);
    const read = vi.fn().mockImplementation(failDuringNavigation);
    await expect(readAfterNavigation(page, read)).rejects.toBe(error);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
