

/** GET /api/highlevel: one HighLevel connection per installation (desktop and Cloud home alike). */
export type HighLevelState = "unavailable" | "signed-out" | "connecting" | "connected" | "needs-sign-in";

export interface HighLevelFlow {
  flowId: string;
  authorizationUrl: string;
  expiresAt?: string;
}

export interface HighLevelStatus {
  state: HighLevelState;
  kind?: "oauth" | "token";
  location?: { id: string; name: string };
  connectedAt?: string;
  flow?: HighLevelFlow;
  problem?: string;
}


export const HIGHLEVEL_API = "/api/highlevel";
export const HIGHLEVEL_SLUG = "highlevel";


export function isHighLevelStatus(value: unknown): value is HighLevelStatus {
  if (!value || typeof value !== "object") return false;
  const state = (value as { state?: unknown }).state;
  return state === "unavailable" || state === "signed-out" || state === "connecting" || state === "connected" || state === "needs-sign-in";
}


/** Starts a sign-in, opens HighLevel's page and waits for the server to report the outcome. */


/** Follows a flow the server already has (opening its page first when asked) until it ends or the person cancels. */
