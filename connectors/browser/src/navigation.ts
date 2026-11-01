import type { Frame, Page } from "playwright-core";

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
      if (!(error instanceof Error) || !error.message.includes("Execution context was destroyed")) throw error;
      if (!committed) await new Promise<void>((resolve, reject) => {
        onCommit = resolve;
        timer = setTimeout(() => reject(new Error("Browser navigation did not commit within 4 seconds")), 4000);
      });
      await page.waitForLoadState("domcontentloaded", { timeout: 4000 });
      return await read();
    }
  } finally {
    page.off("framenavigated", onNavigation);
    if (timer) clearTimeout(timer);
  }
}
