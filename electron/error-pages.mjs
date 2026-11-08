import path from "node:path";
import { pathToFileURL } from "node:url";

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** The page the main window shows when the background server never came up. */
export function buildErrorPage({ allPortsOccupied, logDir }) {
  const serverLogPath = path.join(logDir, "server.log");
  const serverLogHref = pathToFileURL(serverLogPath).href;
  const reason = allPortsOccupied
    ? "Every RelayIt port answered health checks from another process — likely a second copy of the app, or another program on ports 8799–28799. Quit that program, then quit and reopen RelayIt."
    : "The background server didn't come up in time — this is usually slow startup, not a port conflict. Quit and reopen RelayIt.";
  return (
    "data:text/html;charset=utf-8," +
    encodeURIComponent(
      `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f1211;color:#f4f4f1;font:15px -apple-system,system-ui"><div style="text-align:center;max-width:360px"><svg width="56" height="56" viewBox="0 0 64 64" aria-hidden="true"><path d="M39.2 15.2H24.8a16.8 16.8 0 0 0 0 33.6h14.4a16.8 16.8 0 0 0 16.8-16.8" fill="none" stroke="#f4f4f1" stroke-width="6.72" stroke-linecap="round"/><circle cx="51.1" cy="20.1" r="6" fill="#ff5a3a"/></svg><h2 style="font-weight:600;margin:12px 0 6px">RelayIt couldn't start</h2><p style="color:#f4f4f1a8;line-height:1.5">${escapeHtml(reason)} If it keeps happening, check <a target="_blank" rel="noopener" href="${serverLogHref}" style="color:#f4f4f1">${escapeHtml(serverLogPath)}</a>.</p></div></body>`,
    )
  );
}

/** The page the live-desktop viewer shows when it cannot open. */
export function desktopViewerErrorPage(message, retryUrl) {
  const escape = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  return (
    "data:text/html;charset=utf-8," +
    encodeURIComponent(`<!doctype html><meta name="color-scheme" content="dark"><title>Desktop unavailable</title>
      <body style="margin:0;display:grid;place-items:center;height:100vh;background:#0f1211;color:#f4f4f1;font:14px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">
        <main style="max-width:420px;padding:32px;text-align:center"><h2 style="margin:0 0 10px;font-size:18px">Couldn't open the live desktop</h2>
        <p style="margin:0 0 20px;color:#a1a1aa;line-height:1.5">${escape(message)}</p>
        <a href="${escape(retryUrl)}" target="_blank" rel="noreferrer" style="display:inline-block;border-radius:9px;background:#fff;color:#111;padding:9px 14px;text-decoration:none;font-weight:600">Open in browser</a></main>
      </body>`)
  );
}
