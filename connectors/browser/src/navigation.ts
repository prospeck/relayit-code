import type { Frame, Page, Request } from "playwright-core";

/** Load states can belong to the old document. Observe this action's activity before clicking. */
export async function settleAfterAction(page: Page, action: () => Promise<unknown>): Promise<void> {
  const requests = new Set<Request>();
  let actionDone = false;
  let closed = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const settled = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  const activity = () => {
    if (closed) return;
    if (idleTimer) clearTimeout(idleTimer);
    if (actionDone && requests.size === 0) idleTimer = setTimeout(resolve, 500);
  };
  const onRequest = (request: Request) => {
    // A replacement document abandons old fetches, which may never emit requestfinished.
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) requests.clear();
    requests.add(request);
    activity();
  };
  const onFinished = (request: Request) => {
    if (requests.delete(request)) activity();
  };
  const onNavigation = (frame: Frame) => {
    if (frame === page.mainFrame()) activity();
  };
  page.on("request", onRequest);
  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFinished);
  page.on("framenavigated", onNavigation);
  const timeout = setTimeout(
    () => reject(new Error("Browser action did not settle within 12 seconds")),
    12_000,
  );
  try {
    await Promise.all([
      settled,
      action().then(() => {
        actionDone = true;
        activity();
      }),
    ]);
    await page.waitForLoadState("domcontentloaded", { timeout: 12_000 });
  } finally {
    closed = true;
    clearTimeout(timeout);
    if (idleTimer) clearTimeout(idleTimer);
    page.off("request", onRequest);
    page.off("requestfinished", onFinished);
    page.off("requestfailed", onFinished);
    page.off("framenavigated", onNavigation);
  }
}

/** A late navigation can replace the document after an action has already settled. Retry only the read. */
export async function readAfterNavigation<T>(page: Page, read: () => Promise<T>): Promise<T> {
  let committed = false;
  let onCommit: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onNavigation = (frame: Frame) => {
    if (frame !== page.mainFrame()) return;
    committed = true;
    onCommit?.();
  };
  // Observe before reading: DOMContentLoaded may still describe the old document until commit.
  page.on("framenavigated", onNavigation);
  try {
    try {
      return await read();
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("Execution context was destroyed"))
        throw error;
      if (!committed)
        await new Promise<void>((resolve, reject) => {
          onCommit = resolve;
          timer = setTimeout(
            () => reject(new Error("Browser navigation did not commit within 4 seconds")),
            4000,
          );
        });
      await page.waitForLoadState("domcontentloaded", { timeout: 4000 });
      return await read();
    }
  } finally {
    page.off("framenavigated", onNavigation);
    if (timer) clearTimeout(timer);
  }
}
