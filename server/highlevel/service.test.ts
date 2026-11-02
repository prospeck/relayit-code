import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createHighLevelService } from "./service.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
it("connects a private integration directly and never consults a saved relay setting", async () => {
  const dataDir = mkdtempSync(resolve(".relayit-highlevel-test-")); dirs.push(dataDir);
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ location: { id: "loc_fixture", name: "Fixture location" } }));
  const service = createHighLevelService({ dataDir, fetch: fetcher, env: { OMB_HIGHLEVEL_RELAY_URL: "https://retired.example.test" } });
  expect(service.status()).toEqual({ state: "signed-out" });
  expect(fetcher).not.toHaveBeenCalled();
  const status = await service.connectWithToken("pit-fixture_credential", "loc_fixture");
  expect(status).toMatchObject({ state: "connected", kind: "token", location: { id: "loc_fixture", name: "Fixture location" } });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]?.[0]).toBe("https://services.leadconnectorhq.com/locations/loc_fixture");
  expect(JSON.stringify(status)).not.toContain("pit-");
  expect(service.disconnect()).toEqual({ state: "signed-out" });
  service.close();
});
