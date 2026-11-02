import { z } from "zod";
import type { GoogleService } from "../google/service.ts";
import { PASS, type RouteHandler } from "./table.ts";

const connect = z.object({ fake: z.boolean().optional(), clientId: z.string().max(4096).optional(), clientSecret: z.string().max(4096).optional() }).strict();

export function createGoogleRoutes(service: GoogleService): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/google" && !path.startsWith("/api/google/")) return PASS;
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Only the owner can manage Google." });
    res.setHeader("Cache-Control", "no-store");
    try {
      if (path === "/api/google" && method === "GET") return json(res, 200, await service.status());
      if (path === "/api/google" && method === "DELETE") return json(res, 200, await service.disconnect());
      if (path === "/api/google/health" && method === "POST") return json(res, 200, await service.health());
      if (path === "/api/google/connect" && method === "POST") {
        const parsed = connect.safeParse(await readBody(req, 12_000));
        if (!parsed.success) return json(res, 400, { error: "Enter a Google Desktop app OAuth client, or choose the demo inbox." });
        return json(res, 200, await service.connect(parsed.data));
      }
      return json(res, 405, { error: "method not allowed" });
    } catch {
      return json(res, 400, { error: "Google could not connect. Check your OAuth setup and encrypted storage, then reconnect." });
    }
  };
}
