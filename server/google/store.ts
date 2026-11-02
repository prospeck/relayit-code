import { join } from "node:path";
import { z } from "zod";
import type { SecretAccess } from "../../connectors/google/src/contract.ts";
import { CredentialDocument, holdCredentialValues } from "../credential-store.ts";

const document = z.object({ version: z.literal(1), values: z.record(z.string(), z.string()) });

/** Server-only access: no HTTP or MCP operation exposes get(). */
export class GoogleSecrets implements SecretAccess {
  private readonly document: CredentialDocument<z.infer<typeof document>>;
  constructor(dataDir: string) {
    this.document = new CredentialDocument(dataDir, "google", {
      file: join(dataDir, "google.json.enc"), keyFile: join(dataDir, "google-key"),
    }, value => document.parse(value));
  }
  private read(): Record<string, string> {
    const values = this.document.read()?.values ?? {};
    for (const [name, value] of Object.entries(values)) this.hold(name, value);
    return values;
  }
  private hold(name: string, value: string): void {
    if (name === "google.client.secret") holdCredentialValues(value);
    if (name === "google.oauth.tokens") {
      holdCredentialValues(value);
      try {
        const tokens = JSON.parse(value);
        holdCredentialValues(tokens.accessToken);
        holdCredentialValues(tokens.refreshToken);
      } catch { /* Invalid legacy token text must still be redacted. */ }
    }
  }
  async get(name: string): Promise<string | null> { return this.read()[name] ?? null; }
  async set(name: string, value: string): Promise<void> {
    this.hold(name, value);
    this.document.write({ version: 1, values: { ...this.read(), [name]: value } });
  }
  async delete(name: string): Promise<void> {
    const values = this.read();
    delete values[name];
    this.document.write({ version: 1, values });
  }
}
