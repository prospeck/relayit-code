/** This month's included X calls, as the RelayIt Cloud relay counts them (`GET <relay>/usage`). `usedUp`: no call is
 * left this month. `resetsAt`: the first of next month (UTC, ISO). `trialEndsAt`: during a free trial, when the full
 * allowance starts. */


/** `GET /api/x/status`, the Apps page's X card. Never a key or a token.
 * `using`: the credential the X tools use now, the person's own treg key before the plan's included calls; null when
 * neither is held, and then no bot is shown the X tools.
 * `included`: this server holds a RelayIt Cloud plan's included X calls. `unavailable`: the Admin said this desktop's
 * paid sign-in gets none. `usage`: the included calls this month, when the relay answered. */
export interface XConnectorStatus {
  using: "own" | null;
  ownKey: boolean;


}


/** The relay's answer as XIncludedUsage, or null for anything else. Every call used reads as used up. */


export function isXConnectorStatus(value: unknown): value is XConnectorStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  return (status.using === "own" || status.using === null)
    && typeof status.ownKey === "boolean";
}
