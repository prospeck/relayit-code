/** Thin, optional bridge to the Tauri shell. Everything degrades gracefully in a plain browser. */
export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else window.open(url, "_blank", "noopener");
}

export async function notify(title: string, body: string): Promise<void> {
  if (isTauri()) {
    try {
      const n = await import("@tauri-apps/plugin-notification");
      let ok = await n.isPermissionGranted();
      if (!ok) ok = (await n.requestPermission()) === "granted";
      if (ok) n.sendNotification({ title, body });
    } catch {
      /* notifications are best-effort */
    }
    return;
  }
  if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body });
}

export const platform = (): "mac" | "windows" | "other" => {
  const p = navigator.userAgent;
  return /Mac/.test(p) ? "mac" : /Win/.test(p) ? "windows" : "other";
};
export const modKey = () => (platform() === "mac" ? "⌘" : "Ctrl");
