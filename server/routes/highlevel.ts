// Owner/admin routes for the HighLevel connection. A client session never reaches these: request-auth denies any
// route not on its allow-list. No answer ever carries a token.
import { HighLevelError } from "../highlevel/client.ts";

import type { HighLevelService } from "../highlevel/service.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface HighLevelRouteDeps {
  service: HighLevelService;
}


export function createHighLevelRoutes(deps: HighLevelRouteDeps): RouteHandler {
  const { service } = deps;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/highlevel" && !path.startsWith("/api/highlevel/")) return PASS;
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Only the owner or an admin can manage the HighLevel connection." });
    res.setHeader("Cache-Control", "no-store");
    try {
      if (path === "/api/highlevel") {
        if (method === "GET") return json(res, 200, service.status());
        if (method === "DELETE") return json(res, 200, service.disconnect());
        return json(res, 405, { error: "method not allowed" });
      }


      if (path === "/api/highlevel/token") {
        if (method !== "POST") return json(res, 405, { error: "method not allowed" });
        if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
          return json(res, 415, { error: "content-type must be application/json" });
        }
        const body = await readBody(req, 20_480);
        const token = typeof body?.token === "string" ? body.token.trim() : "";
        const locationId = typeof body?.locationId === "string" ? body.locationId.trim() : "";
        if (!token) return json(res, 400, { error: "Paste a Private Integration token. It starts with pit-." });
        if (!locationId) return json(res, 400, { error: "Enter the location id (Settings → Business Profile in HighLevel)." });
        return json(res, 200, await service.connectWithToken(token, locationId));
      }
      return json(res, 404, { error: "not found" });
    } catch (error) {
      if (error instanceof HighLevelError) return json(res, error.status && error.status >= 400 && error.status < 600 ? error.status : 400, { error: error.message });

      throw error;
    }
  };
}
