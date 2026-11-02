// Kept apart from config.json so a pasted or exported config never carries a token; a token never follows its entry to another URL.
import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";

import { CredentialDocument, holdCredentialValues } from "./credential-store.ts";
import { CREDENTIAL_DIRECTORY } from "../electron/credential-store.mjs";

function namespace(file: string): string {
  return basename(file) === "mcp-oauth.json" ? "mcp-oauth" : `mcp-oauth-${Buffer.from(basename(file)).toString("hex")}`;
}

export function mcpOAuthEncryptedPath(file: string): string {
  return join(dirname(file), CREDENTIAL_DIRECTORY, `${namespace(file)}.enc`);
}

export function mcpOAuthFiles(folder: string): string[] {
  const files = new Set(existsSync(folder) ? readdirSync(folder).filter(file => file.endsWith(".json")) : []);
  const encrypted = join(folder, CREDENTIAL_DIRECTORY);
  if (existsSync(encrypted)) for (const file of readdirSync(encrypted)) {
    if (file === "mcp-oauth.enc") files.add("mcp-oauth.json");
    const match = /^mcp-oauth-([0-9a-f]+)\.enc$/.exec(file);
    if (match) {
      const name = Buffer.from(match[1]!, "hex").toString("utf8");
      if (basename(name) === name && name.endsWith(".json") && namespace(name) === file.slice(0, -4)) files.add(name);
    }
  }
  return [...files];
}

export function removeMcpOAuthFile(file: string): void {
  rmSync(mcpOAuthEncryptedPath(file), { force: true });
  rmSync(file, { force: true });
}

const tokensSchema = z.object({
  access: z.string().min(1),
  refresh: z.string().min(1).optional(),
  expiresAt: z.number().optional(),
  scope: z.string().optional(),
});

const recordSchema = z.object({
  url: z.string(),
  state: z.enum(["needs-sign-in", "signed-in"]),
  issuer: z.string().optional(),
  clientId: z.string().optional(),
  /** Client secrets belong to the encrypted config credential document. */
  tokenAuth: z.enum(["client_secret_post", "client_secret_basic"]).optional(),
  redirectUri: z.string().optional(),
  tokenEndpoint: z.string().optional(),
  revocationEndpoint: z.string().optional(),
  tokens: tokensSchema.optional(),
});

const fileSchema = z.object({
  servers: z.record(z.string(), recordSchema).default({}),
});

export type McpOAuthTokens = z.infer<typeof tokensSchema>;
export type McpOAuthRecord = z.infer<typeof recordSchema>;
type StoreFile = z.infer<typeof fileSchema>;

/** One sign-in as this store keeps it, from anywhere else (a sign-in moved from the person's own computer); null if not. */
export function parseMcpOAuthRecord(value: unknown): McpOAuthRecord | null {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export class McpOAuthStore {
  private readonly document: CredentialDocument<StoreFile>;

  constructor(file: string) {
    this.document = new CredentialDocument(dirname(file), namespace(file), { file }, value => fileSchema.parse(value));
  }

  get(name: string, url: string): McpOAuthRecord | undefined {
    const record = this.read().servers[name];
    return record && record.url === url ? record : undefined;
  }

  put(name: string, record: McpOAuthRecord): void {
    const data = this.read();
    data.servers[name] = recordSchema.parse(record);
    this.write(data);
  }

  delete(name: string): void {
    const data = this.read();
    if (!Object.hasOwn(data.servers, name)) return;
    delete data.servers[name];
    this.write(data);
  }

  // Read through on every call: another process may have changed the file.
  private read(): StoreFile {
    const data = this.document.read() ?? { servers: {} };
    for (const record of Object.values(data.servers)) { holdCredentialValues(record.tokens?.access); holdCredentialValues(record.tokens?.refresh); }
    return data;
  }

  private write(data: StoreFile): void {
    for (const record of Object.values(data.servers)) { holdCredentialValues(record.tokens?.access); holdCredentialValues(record.tokens?.refresh); }
    this.document.write(data);
  }
}
