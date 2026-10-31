import { randomBytes, randomUUID } from "node:crypto";

export const newId = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
export const newToken = (): string => randomBytes(32).toString("base64url");
export const nowIso = (): string => new Date().toISOString();
