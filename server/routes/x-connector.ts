import type { XConnectorStatus } from "../../shared/x-connector.ts";
import type { ServiceCredential } from "../provider-credentials.ts";

import { PASS, type RouteHandler } from "./table.ts";

export const X_STATUS_PATH = "/api/x/status";


export interface XConnectorDeps {
  /** The person's own treg credential. */
  credential: () => ServiceCredential | null;

}

export function createXConnectorRoutes(deps: XConnectorDeps): RouteHandler {
  return async (ctx) => {
    if (ctx.path !== X_STATUS_PATH) return PASS;
    if (ctx.method !== "GET") return void ctx.json(ctx.res, 405, { error: "Use GET." });
    const using = deps.credential();
    const status: XConnectorStatus = {
      using: using ? "own" : null,
      ownKey: using !== null,

    };
    ctx.res.setHeader("cache-control", "no-store");
    ctx.json(ctx.res, 200, status);
  };
}
