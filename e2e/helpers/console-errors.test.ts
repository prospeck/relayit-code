import { describe, expect, it } from "vitest";
import { isCoreRestartNetworkError } from "./console-errors.ts";

const coreUrl = "http://127.0.0.1:47821";
const socketError = (url: string) => `WebSocket connection to '${url}' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED`;

describe("core restart console error classification", () => {
  it("recognizes the observed core event-stream connection refusal even when its source is live.ts", () => {
    expect(isCoreRestartNetworkError(socketError("ws://127.0.0.1:47821/api/events?token=test"), "http://127.0.0.1:5173/src/lib/live.ts", coreUrl)).toBe(true);
  });
  it.each(["CONNECTION_REFUSED", "CONNECTION_RESET", "EMPTY_RESPONSE"])("recognizes a core API resource failure: %s", (code) => {
    expect(isCoreRestartNetworkError(`Failed to load resource: net::ERR_${code}`, coreUrl + "/api/conversations", coreUrl)).toBe(true);
  });
  it.each([
    socketError("ws://127.0.0.1:5173/api/events"),
    socketError("ws://example.com/api/events"),
    socketError("ws://127.0.0.1:47821/unrelated"),
    "WebSocket application error",
    "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
    "Failed to load resource: net::ERR_CERT_AUTHORITY_INVALID",
    "Uncaught TypeError: Cannot read properties of undefined",
  ])("keeps unrelated errors: %s", (text) => {
    expect(isCoreRestartNetworkError(text, coreUrl + "/api/state", coreUrl)).toBe(false);
  });
  it.each(["http://127.0.0.1:5173/api/state", "http://example.com/api/state", coreUrl + "/asset.js", ""])("keeps resource failures outside the core API: %s", (source) => {
    expect(isCoreRestartNetworkError("Failed to load resource: net::ERR_CONNECTION_REFUSED", source, coreUrl)).toBe(false);
  });
});
