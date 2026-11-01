import type { Frame, Page, Request } from "playwright-core";

/** Load states can belong to the old document. Observe this action's activity before clicking. */
export async function settleAfterAction(page: Page, action: () => Promise<unknown>): Promise<void> {
  const requests = new Set<Request>();
  const origin = new URL(page.url()).origin;
  const deadlineAt = Date.now() + 12_000;
  let actionDone = false;
  let closed = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let resolve!: () => void;
  const settled = new Promise<void>((onResolve) => {
    resolve = onResolve;
  });
  const activity = () => {
    if (closed) return;
    if (idleTimer) clearTimeout(idleTimer);
    if (actionDone && requests.size === 0) idleTimer = setTimeout(resolve, 500);
  };
  const onRequest = (request: Request) => {
    const url = new URL(request.url());
    if (!["http:", "https:"].includes(url.protocol) || request.serviceWorker()) return;
    // Edge background traffic and subresources (including favicons) need not ever finish.
    // Keep same-origin fetch/XHR: a submit can navigate only after its response arrives.
    try {
      if (request.frame() !== page.mainFrame()) return;
    } catch {
      // A browser-owned request can arrive before Playwright has a frame for it.
      return;
    }
    const navigation = request.isNavigationRequest() && request.resourceType() === "document";
    if (
      !navigation &&
      (url.origin !== origin || !["fetch", "xhr"].includes(request.resourceType()))
    )
      return;
    // A replacement document abandons old fetches, which may never emit requestfinished.
    if (navigation) requests.clear();
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
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, onReject) => {
    timeout = setTimeout(
      () => onReject(new Error("Browser action did not settle within 12 seconds")),
      12_000,
    );
  });
  try {
    await Promise.race([
      deadline,
      (async () => {
        await action();
        if (closed) return;
        actionDone = true;
        activity();
        await settled;
        await page.waitForLoadState("domcontentloaded", {
          timeout: Math.max(1, deadlineAt - Date.now()),
        });
      })(),
    ]);
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
