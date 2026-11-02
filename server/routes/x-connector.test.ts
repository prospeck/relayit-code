import { describe, expect, it, vi } from "vitest";
import type { ServiceCredential } from "../provider-credentials.ts";
import { PASS, type RouteContext } from "./table.ts";
import { createXConnectorRoutes } from "./x-connector.ts";
const OWN: ServiceCredential = { token: "treg_own_key", api: "https://treg.to" };
async function get(handler: ReturnType<typeof createXConnectorRoutes>, path = "/api/x/status", method = "GET") {
  const sent: { status?: number; body?: any } = {};
  const url = new URL(`http://127.0.0.1${path}`);
  const ctx = {
    path: url.pathname, url, method,
    res: { setHeader: vi.fn() },
    json: (_res: unknown, status: number, body: unknown) => { sent.status = status; sent.body = body; },
  } as unknown as RouteContext;
  const out = await handler(ctx);
  return { out, ...sent };
}

describe("GET /api/x/status", () => {
  it("passes other paths and answers only GET", async () => {
    const handler = createXConnectorRoutes({ credential: () => OWN });
    expect((await get(handler, "/api/x/statuses")).out).toBe(PASS);
    expect((await get(handler, "/api/internal/x/search")).out).toBe(PASS);
    expect(await get(handler, "/api/x/status", "POST")).toMatchObject({ status: 405 });
  });
  it("follows the person's own credential on every request without disclosing it", async () => {
    let credential: ServiceCredential | null = OWN;
    const handler = createXConnectorRoutes({ credential: () => credential });
    expect((await get(handler)).body).toEqual({ using: "own", ownKey: true });
    expect(JSON.stringify((await get(handler)).body)).not.toContain(OWN.token);
    expect(JSON.stringify((await get(handler)).body)).not.toContain(OWN.api);
    credential = null;
    expect((await get(handler)).body).toEqual({ using: null, ownKey: false });
  });
});
