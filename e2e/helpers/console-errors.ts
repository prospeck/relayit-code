/** Chromium reports expected connection failures while this harness deliberately stops core. */
export function isCoreRestartNetworkError(
  text: string,
  sourceUrl: string,
  coreUrl: string,
): boolean {
  const socket = text.match(
    /^WebSocket connection to '([^']+)' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED$/,
  );
  try {
    const core = new URL(coreUrl);
    if (socket) {
      const url = new URL(socket[1]!);
      return url.origin === core.origin.replace(/^http/, "ws") && url.pathname === "/api/events";
    }
    if (
      !/^Failed to load resource: net::ERR_(CONNECTION_REFUSED|CONNECTION_RESET|EMPTY_RESPONSE)$/.test(
        text,
      )
    )
      return false;
    const url = new URL(sourceUrl);
    return url.origin === core.origin && url.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}
