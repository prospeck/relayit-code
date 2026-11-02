import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CredentialStorageError } from "../electron/credential-store.mjs";
import { credentialStore, holdCredentialValues } from "./credential-store.ts";
import { isSecretName } from "./redact.ts";
import { writeFileAtomic } from "./atomic.ts";
import { parseJson, type JsonObject, type JsonValue } from "./schema.ts";
import { PROVIDER_AUTH_FOLDER_ENV } from "./provider-auth-paths.ts";

const PREFIX = "omb-credential:";
const valuesSchema = z.record(z.string(), z.object({ path: z.array(z.string()), value: z.string() }));
type Values = z.infer<typeof valuesSchema>;

function secretField(path: string[]): boolean {
  const key = path.at(-1) ?? "";
  if (/(?:key|token|secret|password|passwd)$/i.test(key)) return true;
  if (path[0] === "opencodeGo" && path[1] === "providerKeys") return true;
  if (path[0] === "instances" && path[2] === "environment") return !(PROVIDER_AUTH_FOLDER_ENV as readonly string[]).includes(key);
  return path[0] === "mcpServers" && (path[2] === "env" || path[2] === "headers");
}

/** Every secretField is encrypted and held, except what is plainly a setting in an env block: masking NODE_ENV's
 * "production" or a path would blank those words everywhere. Anything else there may be a key under an ordinary name. */
const PLAIN_SETTING = /^(?:production|development|staging|localhost|enabled|disabled|verbose|[0-9.]+)$|^[/~.]|^https?:\/\//i;

function holdIfCredential(path: string[], value: string): void {
  const inEnvBlock = path[2] === "env" || path[2] === "environment";
  if (!inEnvBlock || isSecretName(path.at(-1) ?? "") || !PLAIN_SETTING.test(value)) holdCredentialValues(value);
}

function storedValues(dataDir: string): Values {
  const raw = credentialStore(dataDir).read("config");
  try { return raw === undefined ? {} : valuesSchema.parse(raw); } catch { throw new CredentialStorageError(); }
}

export function holdConfigCredentialValues(config: unknown): void {
  const visit = (value: unknown, path: string[]): void => {
    if (typeof value === "string" && secretField(path)) holdIfCredential(path, value);
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) visit(item, [...path, key]);
  };
  visit(config, []);
}

export function hydrateConfigCredentials(dataDir: string, config: JsonObject): JsonObject {
  const values = storedValues(dataDir);
  const visit = (value: JsonValue, path: string[]): JsonValue => {
    if (typeof value === "string") {
      if (value.startsWith(PREFIX)) {
        const id = value.slice(PREFIX.length);
        const record = values[id];
        if (!record || JSON.stringify(record.path) !== JSON.stringify(path)) throw new CredentialStorageError();
        holdIfCredential(path, record.value);
        return record.value;
      }
      if (secretField(path)) holdIfCredential(path, value);
      return value;
    }
    if (Array.isArray(value)) return value.map((item, index) => visit(item, [...path, String(index)]));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, [...path, key])]));
    return value;
  };
  return visit(config, []) as JsonObject;
}

/** Keep old references until config.json commits: a crash between writes must leave both versions decryptable. */
export function persistConfigCredentials(dataDir: string, config: JsonObject): void {
  const store = credentialStore(dataDir);
  const previous = storedValues(dataDir);
  const values: Values = {};
  const visit = (value: JsonValue, path: string[]): JsonValue => {
    if (typeof value === "string" && value && secretField(path)) {
      holdIfCredential(path, value);
      const id = randomUUID();
      values[id] = { path, value };
      return PREFIX + id;
    }
    if (Array.isArray(value)) return value.map((item, index) => visit(item, [...path, String(index)]));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, [...path, key])]));
    return value;
  };
  const disk = visit(config, []);
  if (Object.keys(values).length || Object.keys(previous).length) store.write("config", { ...previous, ...values });
  writeFileAtomic(join(dataDir, "config.json"), JSON.stringify(disk, null, 2), { mode: 0o600 });
  if (process.platform !== "win32") {
    const fd = openSync(dataDir, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
    if (Object.keys(values).length || Object.keys(previous).length) store.write("config", values);
  }
  // Windows cannot fsync a directory; retain retired encrypted values there.
}

export function readConfigCredentials(dataDir: string): JsonObject {
  const raw = parseJson(readFileSync(join(dataDir, "config.json"), "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const config = hydrateConfigCredentials(dataDir, raw as JsonObject);
  let plaintext = false;
  const inspect = (value: JsonValue, path: string[]): void => {
    if (typeof value === "string" && value && secretField(path) && !value.startsWith(PREFIX)) plaintext = true;
    else if (Array.isArray(value)) value.forEach((item, index) => inspect(item, [...path, String(index)]));
    else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => inspect(item, [...path, key]));
  };
  inspect(raw as JsonObject, []);
  if (plaintext) persistConfigCredentials(dataDir, config);
  return config;
}
