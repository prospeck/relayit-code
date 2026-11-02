import type { z } from "zod";

export type ActPreview = {
  title: string;
  summary: string;
  service: string;
  recipient?: string | null;
  details?: { label: string; value: string }[];
};

export interface SecretAccess {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

export interface KvAccess {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
}

export type ToolContext = {
  conversationId: string;
  runId: string;
  signal: AbortSignal;
  idempotencyKey: string | null;
  profile: unknown;
  memory: unknown[];
  secrets: SecretAccess;
  kv: KvAccess;
  status(label: string): void;
};

export interface ToolDef<I = any, O = any> {
  name: string;
  description: string;
  domain: string;
  toolClass: "read" | "prepare" | "act";
  service: string;
  input: z.ZodType<I>;
  label?: (input: I) => string;
  preview?: (input: I, ctx: ToolContext) => ActPreview | Promise<ActPreview>;
  untrustedOutput?: boolean;
  run(input: I, ctx: ToolContext): Promise<O>;
}

export const defineTool = <I, O>(def: ToolDef<I, O>): ToolDef<I, O> => def;
