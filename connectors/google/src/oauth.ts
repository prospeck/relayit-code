import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { SecretAccess } from "./contract.ts";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.events",
];

export type GoogleTokens = {
  accessToken: string;
  refreshToken: string;
  /** Unix epoch milliseconds. */
  expiresAt: number;
  scope: string;
  email?: string;
};

export type OAuthClientOptions = {
  clientId: string;
  clientSecret?: string;
  tokenUrl?: string;
};

async function exchange(
  fields: Record<string, string>,
  options: OAuthClientOptions,
  previous?: GoogleTokens,
  signal?: AbortSignal,
): Promise<GoogleTokens> {
  const body = new URLSearchParams({ ...fields, client_id: options.clientId });
  if (options.clientSecret) body.set("client_secret", options.clientSecret);
  const response = await fetch(options.tokenUrl ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    body,
    signal,
  });
  // Do not include response bodies: providers can echo sensitive request values.
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status})`);
  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!data.access_token || !Number.isFinite(Number(data.expires_in))) {
    throw new Error("Google returned an invalid token response");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previous?.refreshToken ?? "",
    expiresAt: Date.now() + Number(data.expires_in) * 1000,
    scope: data.scope ?? previous?.scope ?? fields.scope ?? "",
    ...(previous?.email ? { email: previous.email } : {}),
  };
}

const connectedHtml = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Google sign-in received</title>
<style>body{margin:0;background:#f6f7f4;color:#27352d;font:18px system-ui;display:grid;place-items:center;min-height:100vh}main{max-width:440px;margin:24px;padding:40px;border-radius:20px;background:white;box-shadow:0 8px 40px #27352d0c}h1{font-size:26px;font-weight:600}p{line-height:1.6;color:#5a665e}</style>
<main><h1>Sign-in received</h1><p>Return to RelayIt to check Gmail and Calendar access. You can close this tab.</p></main></html>`;

export async function startGoogleAuth(
  options: OAuthClientOptions & {
    scopes: readonly string[];
    openUrl: (url: string) => void | Promise<void>;
    authBase?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<GoogleTokens> {
  const verifier = randomBytes(64).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const controller = new AbortController();
  const server = createServer();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let handling = false;
  let cancel: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Cannot start Google OAuth callback");
    const redirectUri = `http://127.0.0.1:${address.port}/callback`;
    const url = new URL(options.authBase ?? "https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: options.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: options.scopes.join(" "),
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    }).toString();
    const completion = new Promise<GoogleTokens>((resolve, reject) => {
      cancel = () => { controller.abort(); reject(new Error("Google authorization cancelled")); };
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.signal?.aborted) cancel();
      timer = setTimeout(
        () => {
          reject(new Error("Google authorization timed out"));
          controller.abort();
        },
        options.timeoutMs ?? 5 * 60_000,
      );
      server.once("error", reject);
      server.on("request", (request, response) => {
        const callback = new URL(request.url ?? "/", redirectUri);
        if (callback.pathname !== "/callback" || request.method !== "GET") {
          response.writeHead(404).end("Not found");
          return;
        }
        if (handling) {
          response.writeHead(409).end("Authorization is already being handled");
          return;
        }
        const received = Buffer.from(callback.searchParams.get("state") ?? "");
        const expected = Buffer.from(state);
        if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
          response
            .writeHead(400)
            .end("Authorization state did not match. Return to RelayIt and try again.");
          reject(new Error("Google authorization state mismatch"));
          return;
        }
        handling = true;
        if (callback.searchParams.has("error")) {
          response.writeHead(400).end("Google connection was cancelled. You can close this tab.");
          reject(
            new Error(
              callback.searchParams.get("error") === "access_denied"
                ? "Google authorization denied"
                : "Google authorization failed",
            ),
          );
          return;
        }
        const code = callback.searchParams.get("code");
        if (!code) {
          response.writeHead(400).end("Missing authorization code");
          reject(new Error("Google authorization code is missing"));
          return;
        }
        void exchange(
          {
            grant_type: "authorization_code",
            code,
            code_verifier: verifier,
            redirect_uri: redirectUri,
            scope: options.scopes.join(" "),
          },
          options,
          undefined,
          controller.signal,
        ).then(
          (tokens) => {
            response.writeHead(200, {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "no-store",
            });
            response.end(connectedHtml);
            resolve(tokens);
          },
          (error) => {
            response.writeHead(502).end("Could not connect. Return to RelayIt and try again.");
            reject(error);
          },
        );
      });
    });
    const [tokens] = await Promise.all([
      completion,
      Promise.resolve().then(() => options.openUrl(url.toString())),
    ]);
    return tokens;
  } finally {
    if (cancel) options.signal?.removeEventListener("abort", cancel);
    if (timer) clearTimeout(timer);
    controller.abort();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
}

export function refreshTokens(
  tokens: GoogleTokens,
  options: OAuthClientOptions,
): Promise<GoogleTokens> {
  if (!tokens.refreshToken)
    return Promise.reject(new Error("Google reconnect required: no refresh token"));
  return exchange(
    { grant_type: "refresh_token", refresh_token: tokens.refreshToken },
    options,
    tokens,
  );
}

export class TokenStore {
  private secrets: SecretAccess;
  private options: OAuthClientOptions;
  private refreshing?: Promise<string>;
  constructor(secrets: SecretAccess, options: OAuthClientOptions) {
    this.secrets = secrets;
    this.options = options;
  }
  async get(): Promise<GoogleTokens | null> {
    const value = await this.secrets.get("google.oauth.tokens");
    if (!value) return null;
    const tokens = JSON.parse(value) as GoogleTokens;
    if (
      typeof tokens.accessToken !== "string" ||
      typeof tokens.refreshToken !== "string" ||
      !Number.isFinite(tokens.expiresAt) ||
      typeof tokens.scope !== "string"
    ) {
      throw new Error("Stored Google credentials are invalid; reconnect Google");
    }
    return tokens;
  }
  async set(tokens: GoogleTokens): Promise<void> {
    await this.secrets.set("google.oauth.tokens", JSON.stringify(tokens));
  }
  async delete(): Promise<void> {
    await this.secrets.delete("google.oauth.tokens");
  }
  async getValidAccessToken(): Promise<string> {
    if (this.refreshing) return this.refreshing;
    const tokens = await this.get();
    if (!tokens) throw new Error("Google is not connected");
    if (tokens.expiresAt - Date.now() >= 60_000) return tokens.accessToken;
    // Recheck after the async secret read so concurrent callers share one refresh.
    if (!this.refreshing) {
      this.refreshing = refreshTokens(tokens, this.options)
        .then(async (updated) => {
          await this.set(updated);
          return updated.accessToken;
        })
        .finally(() => {
          this.refreshing = undefined;
        });
    }
    return this.refreshing;
  }
}
