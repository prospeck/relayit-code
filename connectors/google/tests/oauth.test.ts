import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { SecretAccess } from "@relayit/shared";
import { GOOGLE_SCOPES, refreshTokens, startGoogleAuth, TokenStore } from "../src/oauth.ts";
import type { GoogleTokens } from "../src/oauth.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});

async function tokenServer(handler: (body: URLSearchParams) => unknown): Promise<string> {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk.toString();
    try {
      const result = handler(new URLSearchParams(body));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    } catch {
      res.writeHead(400).end();
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  return `http://127.0.0.1:${address.port}/token`;
}

function secrets(): SecretAccess & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      values.delete(key);
    },
  };
}

describe("desktop OAuth", () => {
  it("uses a 64-byte S256 PKCE verifier, consent parameters, loopback callback, and token exchange", async () => {
    let authUrl: URL;
    let exchangeBody: URLSearchParams | undefined;
    const tokenUrl = await tokenServer((body) => {
      exchangeBody = body;
      return {
        access_token: "test-access",
        refresh_token: "test-refresh",
        expires_in: 3600,
        scope: "openid email",
      };
    });
    const before = Date.now();
    const tokens = await startGoogleAuth({
      clientId: "desktop-test",
      clientSecret: "test-client-secret",
      scopes: GOOGLE_SCOPES,
      tokenUrl,
      async openUrl(url) {
        authUrl = new URL(url);
        expect(authUrl.origin + authUrl.pathname).toBe(
          "https://accounts.google.com/o/oauth2/v2/auth",
        );
        const params = authUrl.searchParams;
        expect(params.get("client_id")).toBe("desktop-test");
        expect(params.get("response_type")).toBe("code");
        expect(params.get("access_type")).toBe("offline");
        expect(params.get("prompt")).toBe("consent");
        expect(params.get("include_granted_scopes")).toBe("true");
        expect(params.get("scope")).toBe(GOOGLE_SCOPES.join(" "));
        expect(params.get("code_challenge_method")).toBe("S256");
        expect(params.has("client_secret")).toBe(false);
        const callback = new URL(params.get("redirect_uri")!);
        expect(callback.hostname).toBe("127.0.0.1");
        expect(callback.pathname).toBe("/callback");
        expect(Number(callback.port)).toBeGreaterThan(0);
        callback.searchParams.set("state", params.get("state")!);
        callback.searchParams.set("code", "test-code");
        const response = await fetch(callback);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain("You can close this tab");
      },
    });
    expect(tokens.accessToken).toBe("test-access");
    expect(tokens.refreshToken).toBe("test-refresh");
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600_000);
    expect(exchangeBody!.get("code")).toBe("test-code");
    expect(exchangeBody!.get("grant_type")).toBe("authorization_code");
    expect(exchangeBody!.get("client_secret")).toBe("test-client-secret");
    expect(exchangeBody!.get("redirect_uri")).toBe(authUrl!.searchParams.get("redirect_uri"));
    const verifier = exchangeBody!.get("code_verifier")!;
    expect(Buffer.from(verifier, "base64url").length).toBe(64);
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
      authUrl!.searchParams.get("code_challenge"),
    );
    await expect(fetch(authUrl!.searchParams.get("redirect_uri")!)).rejects.toThrow();
  });

  it.each(["wrong", "missing"])(
    "rejects a %s callback state and closes the server",
    async (mode) => {
      let callback: URL;
      await expect(
        startGoogleAuth({
          clientId: "test",
          scopes: GOOGLE_SCOPES,
          async openUrl(url) {
            callback = new URL(new URL(url).searchParams.get("redirect_uri")!);
            callback.searchParams.set("code", "test-code");
            if (mode === "wrong") callback.searchParams.set("state", "wrong-state");
            await fetch(callback).catch(() => {});
          },
        }),
      ).rejects.toThrow("state mismatch");
      await expect(fetch(callback!)).rejects.toThrow();
    },
  );

  it("handles denied consent", async () => {
    await expect(
      startGoogleAuth({
        clientId: "test",
        scopes: GOOGLE_SCOPES,
        async openUrl(url) {
          const auth = new URL(url);
          const callback = new URL(auth.searchParams.get("redirect_uri")!);
          callback.searchParams.set("state", auth.searchParams.get("state")!);
          callback.searchParams.set("error", "access_denied");
          await fetch(callback).catch(() => {});
        },
      }),
    ).rejects.toThrow("authorization denied");
  });

  it("times out and closes the callback listener", async () => {
    let callback = "";
    await expect(
      startGoogleAuth({
        clientId: "test",
        scopes: [],
        timeoutMs: 30,
        openUrl(url) {
          callback = new URL(url).searchParams.get("redirect_uri")!;
        },
      }),
    ).rejects.toThrow("timed out");
    await expect(fetch(callback)).rejects.toThrow();
  });

  it("closes the listener when opening the browser fails", async () => {
    let callback = "";
    await expect(
      startGoogleAuth({
        clientId: "test",
        scopes: [],
        openUrl(url) {
          callback = new URL(url).searchParams.get("redirect_uri")!;
          throw new Error("Browser unavailable");
        },
      }),
    ).rejects.toThrow("Browser unavailable");
    await expect(fetch(callback)).rejects.toThrow();
  });

  it("keeps token endpoint errors free of response secrets", async () => {
    const tokenUrl = await tokenServer(() => {
      throw new Error("sensitive response");
    });
    await expect(
      refreshTokens(
        { accessToken: "old", refreshToken: "refresh", scope: "email", expiresAt: 0 },
        { clientId: "test", tokenUrl },
      ),
    ).rejects.toThrow("Google token exchange failed (400)");
  });
});

describe("token refresh and secret storage", () => {
  const expired: GoogleTokens = {
    accessToken: "old",
    refreshToken: "refresh",
    expiresAt: 0,
    scope: "email",
    email: "aarav@example.com",
  };
  it("preserves refresh token, scope, and email if omitted on refresh", async () => {
    let request: URLSearchParams;
    const tokenUrl = await tokenServer((body) => {
      request = body;
      return { access_token: "new", expires_in: 3600 };
    });
    const tokens = await refreshTokens(expired, { clientId: "test", tokenUrl });
    expect(request!.get("grant_type")).toBe("refresh_token");
    expect(request!.get("refresh_token")).toBe("refresh");
    expect(tokens).toMatchObject({
      accessToken: "new",
      refreshToken: "refresh",
      scope: "email",
      email: "aarav@example.com",
    });
    expect(tokens.expiresAt).toBeGreaterThan(Date.now() + 3500_000);
  });

  it("refreshes tokens within 60 seconds, persists JSON, and shares concurrent refreshes", async () => {
    let requests = 0;
    const tokenUrl = await tokenServer(() => {
      requests++;
      return { access_token: "new", refresh_token: "rotated", expires_in: 3600 };
    });
    const access = secrets();
    const store = new TokenStore(access, { clientId: "test", tokenUrl });
    expect(await store.get()).toBeNull();
    await store.set({ ...expired, expiresAt: Date.now() + 30_000 });
    expect(await Promise.all([store.getValidAccessToken(), store.getValidAccessToken()])).toEqual([
      "new",
      "new",
    ]);
    expect(requests).toBe(1);
    expect(JSON.parse(access.values.get("google.oauth.tokens")!)).toMatchObject({
      refreshToken: "rotated",
    });
    expect(await store.getValidAccessToken()).toBe("new");
    expect(requests).toBe(1);
    await store.delete();
    await expect(store.getValidAccessToken()).rejects.toThrow("not connected");
  });

  it("requires reconnection when no refresh token exists", async () => {
    await expect(
      refreshTokens({ ...expired, refreshToken: "" }, { clientId: "test" }),
    ).rejects.toThrow("reconnect required");
  });
});
