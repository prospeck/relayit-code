import { join } from "node:path";
import { z } from "zod";

import { CredentialDocument, holdCredentialValues } from "../credential-store.ts";

export const HIGHLEVEL_FILE = "highlevel.json.enc";
export const HIGHLEVEL_KEY_FILE = "highlevel-key";

const connectionSchema = z.object({
  kind: z.enum(["oauth", "token"]),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  /** Epoch ms; absent for a Private Integration token, which never expires on its own. */
  expiresAt: z.number().optional(),
  locationId: z.string().min(1),
  companyId: z.string().optional(),
  userId: z.string().optional(),
  locationName: z.string().optional(),
  scopes: z.string().default(""),
  connectedAt: z.number(),
  state: z.enum(["signed-in", "needs-sign-in"]),
  /** Why the connection needs a new sign-in, in one plain sentence. */
  problem: z.string().optional(),
});

const fileSchema = z.object({ version: z.literal(1), connection: connectionSchema.optional() });

/** The stored connection with its secrets. Server-only. */
export type HighLevelConnection = z.infer<typeof connectionSchema>;
type StoreFile = z.infer<typeof fileSchema>;

/** A connection as this store keeps it, from anywhere else (one moved from the person's own computer); null if not. */
export function parseHighLevelConnection(value: unknown): HighLevelConnection | null {
  const parsed = connectionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface HighLevelTokenRotation {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string;
}

const EMPTY: StoreFile = { version: 1 };

export const sameTokens = (a: HighLevelConnection, b: HighLevelConnection): boolean =>
  a.accessToken === b.accessToken && a.refreshToken === b.refreshToken;

export class HighLevelStore {
  private readonly document: CredentialDocument<StoreFile>;
  private readonly now: () => number;
  private cache: StoreFile | null = null;

  constructor(options: { dataDir: string; now?: () => number }) {
    this.document = new CredentialDocument(options.dataDir, "highlevel", {
      file: join(options.dataDir, HIGHLEVEL_FILE), keyFile: join(options.dataDir, HIGHLEVEL_KEY_FILE),
    }, value => fileSchema.parse(value));
    this.now = options.now ?? Date.now;
  }

  private read(): StoreFile {
    if (this.cache) return this.cache;
    const data = this.document.read() ?? EMPTY;
    holdCredentialValues(data.connection?.accessToken);
    holdCredentialValues(data.connection?.refreshToken);
    this.cache = data;
    return data;
  }

  private write(data: StoreFile): void {
    const parsed = fileSchema.parse(data);
    holdCredentialValues(parsed.connection?.accessToken);
    holdCredentialValues(parsed.connection?.refreshToken);
    this.document.write(parsed);
    this.cache = parsed;
  }

  get(): HighLevelConnection | null {
    return this.read().connection ?? null;
  }

  put(connection: Omit<HighLevelConnection, "connectedAt" | "state"> & { connectedAt?: number; state?: HighLevelConnection["state"] }): HighLevelConnection {
    const stored: HighLevelConnection = connectionSchema.parse({ connectedAt: this.now(), state: "signed-in", ...connection });
    this.write({ version: 1, connection: stored });
    return stored;
  }

  /** A refresh rotates both tokens: the new pair replaces the old one at once, so a retry never reuses a spent refresh token.
   * It lands only on the token version it was started from; null when a newer sign-in, rotation or disconnect came first. */
  rotate(tokens: HighLevelTokenRotation, from: HighLevelConnection): HighLevelConnection | null {
    const current = this.get();
    if (!current || !sameTokens(current, from)) return null;
    const { problem: _problem, ...rest } = current;
    const next: HighLevelConnection = {
      ...rest,
      accessToken: tokens.accessToken,
      ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      ...(tokens.expiresAt === undefined ? {} : { expiresAt: tokens.expiresAt }),
      ...(tokens.scopes === undefined ? {} : { scopes: tokens.scopes }),
      state: "signed-in",
    };
    this.write({ version: 1, connection: next });
    return next;
  }

  /** Only for the token version HighLevel rejected: a newer sign-in or rotation stays signed in. */
  markNeedsSignIn(problem: string, rejected: HighLevelConnection): void {
    const current = this.get();
    if (!current || !sameTokens(current, rejected)) return;
    this.write({ version: 1, connection: { ...current, state: "needs-sign-in", problem } });
  }

  clear(): void {
    this.write(EMPTY);
  }

  /** The tokens, for secret redaction. */
  secretValues(): string[] {
    const current = this.get();
    return current ? [current.accessToken, ...(current.refreshToken ? [current.refreshToken] : [])] : [];
  }
}
