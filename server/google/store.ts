import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { SecretAccess } from "../../connectors/google/src/contract.ts";
import { writeFileAtomic } from "../atomic.ts";
import { decryptBrowserState, encryptBrowserState } from "../browser-sites.ts";

const document = z.object({ version: z.literal(1), values: z.record(z.string(), z.string()) });

/** Server-only encrypted storage, using the same AES-GCM format and private local key as saved logins and HighLevel.
 * No HTTP or MCP operation exposes get(); unreadable existing records fail closed rather than being overwritten. */
export class GoogleSecrets implements SecretAccess {
  private readonly file: string;
  private readonly keyFile: string;
  constructor(dataDir: string) {
    this.file = join(dataDir, "google.json.enc");
    this.keyFile = join(dataDir, "google-key");
  }
  private key(create: boolean): string {
    if (existsSync(this.keyFile)) {
      const key = readFileSync(this.keyFile, "utf8").trim();
      if (/^[a-f0-9]{64}$/.test(key)) return key;
      throw new Error("Google encrypted storage cannot be opened.");
    }
    if (!create) throw new Error("Google encrypted storage key is missing.");
    const key = randomBytes(32).toString("hex");
    mkdirSync(join(this.file, ".."), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.keyFile, key, { mode: 0o600 });
    return key;
  }
  private read(): Record<string, string> {
    if (!existsSync(this.file)) return {};
    try {
      return document.parse(JSON.parse(decryptBrowserState(readFileSync(this.file), this.key(false)))).values;
    } catch {
      throw new Error("Google encrypted storage cannot be opened. Restore its key before reconnecting.");
    }
  }
  async get(name: string): Promise<string | null> { return this.read()[name] ?? null; }
  async set(name: string, value: string): Promise<void> {
    const values = this.read();
    values[name] = value;
    writeFileAtomic(this.file, encryptBrowserState(JSON.stringify({ version: 1, values }), this.key(true)), { mode: 0o600 });
  }
  async delete(name: string): Promise<void> {
    const values = this.read();
    delete values[name];
    if (!existsSync(this.file)) return;
    writeFileAtomic(this.file, encryptBrowserState(JSON.stringify({ version: 1, values }), this.key(false)), { mode: 0o600 });
  }
}
