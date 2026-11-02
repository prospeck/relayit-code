import { randomUUID } from "node:crypto";
import { GOOGLE_SCOPES, GoogleClient, TokenStore, checkGoogleAccess, startFakeGoogle, startGoogleAuth } from "../../connectors/google/src/index.ts";
import type { OAuthClientOptions } from "../../connectors/google/src/oauth.ts";
import type { GoogleStatus } from "../../shared/google.ts";
import { GoogleSecrets } from "./store.ts";

export class GoogleService {
  readonly secrets: GoogleSecrets;
  private fake: Awaited<ReturnType<typeof startFakeGoogle>> | null = null;
  private fakeStarting?: Promise<Awaited<ReturnType<typeof startFakeGoogle>>>;
  private tokens?: TokenStore;
  private generation = randomUUID();
  private checked = false;
  private issues: GoogleStatus["issues"] = [];
  private email: string | null = null;
  private flow?: { authorizationUrl?: string; error?: string; running: boolean };
  private auth?: AbortController;
  private checking?: Promise<GoogleStatus>;
  private mode: GoogleStatus["mode"] = "none";
  private restored = false;
  constructor(dataDir: string, privateOptions: { oauth?: Partial<OAuthClientOptions> & { authBase?: string }; fetch?: typeof fetch } = {}) {
    this.secrets = new GoogleSecrets(dataDir);
    this.options = privateOptions;
  }
  private readonly options: { oauth?: Partial<OAuthClientOptions> & { authBase?: string }; fetch?: typeof fetch };
  private async restore(): Promise<void> {
    if (this.restored) return;
    const mode = await this.secrets.get("google.mode");
    this.mode = mode === "real" || mode === "fake" ? mode : "none";
    this.restored = true;
  }
  configured(): boolean { return this.mode !== "none"; }
  connected(): boolean { return this.checked && !this.flow?.running && this.issues.length === 0 && this.mode !== "none"; }
  async status(): Promise<GoogleStatus> {
    await this.restore();
    return {
      mode: this.mode, connected: this.connected(), email: this.email,
      clientConfigured: !!(await this.secrets.get("google.client.id")),
      issues: this.issues,
      ...(this.flow?.running && this.flow.authorizationUrl ? { flow: { authorizationUrl: this.flow.authorizationUrl } } : {}),
      ...(this.flow?.error ? { error: this.flow.error } : {}),
    };
  }
  private async tokenStore(): Promise<TokenStore> {
    if (this.tokens) return this.tokens;
    const clientId = await this.secrets.get("google.client.id");
    const clientSecret = await this.secrets.get("google.client.secret");
    if (!clientId) throw new Error("Add a Desktop app OAuth client ID in Connections first.");
    const generation = this.generation;
    this.tokens = new TokenStore({
      get: (key) => this.secrets.get(key),
      set: async (key, value) => {
        if (generation !== this.generation) throw new Error("Google connection changed; reconnect Google.");
        await this.secrets.set(key, value);
      },
      delete: (key) => this.secrets.delete(key),
    }, { ...this.options.oauth, clientId, ...(clientSecret ? { clientSecret } : {}) });
    return this.tokens;
  }
  async client(assertActive: () => void = () => {}): Promise<GoogleClient> {
    await this.restore();
    if (this.mode === "none") throw new Error("Connect Google or try a demo inbox in Settings → Connections.");
    const generation = this.generation;
    const active = () => {
      assertActive();
      if (generation !== this.generation) throw new Error("Google connection changed. Start a new turn.");
    };
    const fetcher: typeof fetch = (input, init) => {
      active();
      return (this.options.fetch ?? fetch)(input, { ...init, signal: AbortSignal.timeout(30_000), redirect: "error" });
    };
    if (this.mode === "fake") {
      if (!this.fake) {
        this.fakeStarting ??= startFakeGoogle({ port: 0 });
        this.fake = await this.fakeStarting;
      }
      return new GoogleClient({ getAccessToken: async () => "demo-only", gmailBase: this.fake.url, calendarBase: `${this.fake.url}/calendar/v3`, fetch: fetcher });
    }
    const store = await this.tokenStore();
    return new GoogleClient({ getAccessToken: () => store.getValidAccessToken(), fetch: fetcher });
  }
  async health(): Promise<GoogleStatus> {
    if (this.checking) return this.checking;
    const check = async () => {
      await this.restore();
      if (this.mode === "none") return this.status();
      const generation = this.generation;
      try {
        const scope = this.mode === "fake" ? GOOGLE_SCOPES.join(" ") : (await (await this.tokenStore()).get())?.scope ?? "";
        const result = await checkGoogleAccess(await this.client(), scope);
        if (generation === this.generation) {
          this.issues = result.issues;
          this.email = result.email;
          this.checked = true;
        }
      } catch {
        if (generation === this.generation) {
          this.checked = true;
          this.issues = [{ service: "Gmail", kind: "reconnect", message: "Google needs you to sign in again. Reconnect Google." }];
        }
      }
      return this.status();
    };
    this.checking = check().finally(() => { this.checking = undefined; });
    return this.checking;
  }
  async connect(input: { fake?: boolean; clientId?: string; clientSecret?: string }): Promise<GoogleStatus> {
    if (this.flow?.running) throw new Error("Google sign-in is already running. Finish or disconnect before starting again.");
    await this.restore();
    this.auth?.abort();
    this.generation = randomUUID();
    this.tokens = undefined;
    this.checked = false;
    this.issues = [];
    this.email = null;
    if (input.fake) {
      this.mode = "fake";
      this.flow = undefined;
      await this.secrets.set("google.mode", this.mode);
      return this.health();
    }
    if (input.clientId?.trim()) {
      await this.secrets.set("google.client.id", input.clientId.trim());
      if (input.clientSecret !== undefined) await this.secrets.set("google.client.secret", input.clientSecret.trim());
      else await this.secrets.delete("google.client.secret");
    }
    const clientId = await this.secrets.get("google.client.id");
    const clientSecret = await this.secrets.get("google.client.secret");
    if (!clientId) throw new Error("Add your Google Desktop app OAuth client ID first.");
    const flow = { running: true } as NonNullable<GoogleService["flow"]>;
    this.flow = flow;
    const auth = new AbortController();
    this.auth = auth;
    const generation = this.generation;
    let ready!: () => void;
    const opened = new Promise<void>((resolve) => { ready = resolve; });
    void startGoogleAuth({ ...this.options.oauth, clientId, ...(clientSecret ? { clientSecret } : {}), scopes: GOOGLE_SCOPES, signal: auth.signal,
      openUrl: (url) => { flow.authorizationUrl = url; ready(); },
    }).then(async (tokens) => {
      if (generation !== this.generation) return;
      await (await this.tokenStore()).set(tokens);
      this.mode = "real";
      await this.secrets.set("google.mode", this.mode);
      await this.health();
    }).catch(() => {
      if (generation === this.generation) flow.error = "Google sign-in did not finish. Reconnect Google and tick every box on Google's permission screen.";
    }).finally(() => { flow.running = false; ready(); });
    await opened;
    return this.status();
  }
  async disconnect(): Promise<GoogleStatus> {
    this.generation = randomUUID();
    this.auth?.abort();
    this.tokens = undefined;
    this.mode = "none";
    this.restored = true;
    this.flow = undefined;
    this.checked = false;
    this.issues = [];
    this.email = null;
    await this.secrets.delete("google.mode");
    await this.secrets.delete("google.oauth.tokens");
    await this.fake?.close();
    this.fake = null;
    this.fakeStarting = undefined;
    return this.status();
  }
  async close(): Promise<void> { this.auth?.abort(); await this.fake?.close(); }
}
