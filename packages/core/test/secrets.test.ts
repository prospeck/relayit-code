import { describe, expect, it } from "vitest";
import { buildApi } from "../src/api/server.ts";
import { decrypt } from "../src/crypto/secretbox.ts";
import { StaticKeyProvider } from "../src/crypto/keyProvider.ts";
import { randomBytes } from "node:crypto";
import { modelListServer, startApp } from "./helpers/fixtures.ts";
import { ScriptedModel } from "./helpers/scriptedModel.ts";

describe("secret storage and API boundaries", () => {
  it("stores only authenticated ciphertext in the raw secrets table and returns the value", async () => {
    const key = randomBytes(32);
    const app = await startApp(new ScriptedModel(), { keyProvider: new StaticKeyProvider(key) });
    const secret = "synthetic-secret-value-for-storage-test";
    await app.secrets.set("test-key", secret);
    const rows = await app.db.selectFrom("secrets").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(rows[0]!.blob).not.toBe(secret);
    expect(decrypt(key, rows[0]!.blob, "secret:test-key")).toBe(secret);
    expect(await app.secrets.get("test-key")).toBe(secret);
    expect(await app.secrets.get("missing")).toBeNull();
  });

  it("saving a model key through the API never exposes it in audit rows or GET /api/state", async () => {
    const baseUrl = await modelListServer();
    const app = await startApp(new ScriptedModel());
    const api = buildApi(app, "test-session");
    const secret = "synthetic-model-key-without-recognised-prefix";
    const response = await api.request("/api/models/config", {
      method: "PUT",
      headers: { authorization: "Bearer test-session", "content-type": "application/json" },
      body: JSON.stringify({
        model: { provider: "openai", model: "test-chat", baseUrl },
        apiKey: secret,
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(secret);
    expect(await app.secrets.get("model.apiKey.openai")).toBe(secret);
    // Exercise both free-text and nested audit redaction, rather than just an empty log.
    await app.audit.log({
      kind: "tool.result",
      summary: `Result included ${secret}`,
      data: { safe: [secret], apiKey: secret },
    });
    const rows = await app.db.selectFrom("audit_events").selectAll().execute();
    expect(rows.some((r) => r.kind === "secret.saved")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(JSON.stringify(rows)).toContain("[redacted]");
    const stateResponse = await api.request("/api/state", {
      headers: { authorization: "Bearer test-session" },
    });
    expect(stateResponse.status).toBe(200);
    const stateJson = await stateResponse.text();
    expect(stateJson).not.toContain(secret);
    expect(JSON.parse(stateJson)).toMatchObject({
      keySaved: true,
      model: { provider: "openai", model: "test-chat" },
    });
    expect(JSON.stringify(await app.db.selectFrom("secrets").selectAll().execute())).not.toContain(
      secret,
    );
  });
});
