import { LOGIN_FIELD_MAX } from "../../shared/logins.ts";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "../config.ts";
import { indiaServiceSpec } from "../india-services.ts";
import { LoginStore } from "../login-store.ts";
import type { McpServerRouteDeps } from "./mcp-servers.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createIndiaServiceRoutes({ config, cfg, logins: sharedLogins }: Pick<McpServerRouteDeps, "config" | "cfg" | "logins">): RouteHandler {
  const logins = sharedLogins ?? new LoginStore({ dataDir: DATA_DIR });
  return async ({ req, res, path, method, json, readBody }) => {
    if (method !== "POST" || !path.startsWith("/api/mcp/builtins/")) return PASS;
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) return json(res, 415, { error: "content-type must be application/json" });
    const answer = (result: ReturnType<typeof config.add>) => "body" in result
      ? json(res, result.status, result.body)
      : json(res, result.status, { error: result.error });
    const indiaBuiltin = /^\/api\/mcp\/builtins\/(food|travel|payments)$/.exec(path);
    if (method === "POST" && indiaBuiltin) {
      const spec = indiaServiceSpec(indiaBuiltin[1]!, DATA_DIR)!;
      return answer(config.add(spec.name, spec.server));
    }
    if (method === "POST" && path === "/api/mcp/builtins/payments/credentials") {
      const body = await readBody(req, 16_384);
      if (typeof body?.keyId !== "string" || !/^rzp_test_[A-Za-z0-9_]+$/.test(body.keyId) || typeof body.keySecret !== "string" || !body.keySecret.trim() || body.keySecret.length > 4_096) {
        return json(res, 400, { error: "A Razorpay test key ID and secret are required." });
      }
      const password = JSON.stringify({ keyId: body.keyId, keySecret: body.keySecret });
      if (password.length > LOGIN_FIELD_MAX) return json(res, 400, { error: "The test keys exceed the secret store's size limit." });
      if (!cfg.mcpServers?.["india-payments"]) return json(res, 404, { error: "Add the payments connector first." });
      const login = logins.create({ site: "api.razorpay.com", hosts: ["api.razorpay.com"], exactHost: true, username: randomUUID(), password, source: "settings", bots: [] });
      const spec = indiaServiceSpec("payments", DATA_DIR, login.id)!;
      const result = config.replace(spec.name, spec.server);
      if (!("body" in result)) logins.remove(login.id);
      return answer(result);
    }

    return PASS;
  };
}
