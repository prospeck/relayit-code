import type { z } from "zod";
import type { MessagePart, Profile, ToolClass, CardDetail, MemoryFact } from "./index.ts";

/**
 * The contract every in-process tool implements (native connectors such as Google and Payments).
 * MCP connectors follow the equivalent convention in docs/connector-contract.md.
 */

export type ActPreview = {
  title: string;
  summary: string;
  service: string;
  recipient?: string | null;
  amountInr?: number | null;
  details?: CardDetail[];
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
  /** Set only for `act` tools. Same key on retry → the tool must not repeat the side effect. */
  idempotencyKey: string | null;
  profile: Profile | null;
  memory: MemoryFact[];
  secrets: SecretAccess;
  kv: KvAccess;
  /** Updates the live status line in the UI, e.g. "Searching restaurants…". */
  status(label: string): void;
};

export interface ToolDef<I = any, O = any> {
  name: string;
  description: string;
  /** Routing domain: "email" | "calendar" | "food" | "travel" | "payments" | "memory" | "web" | "browser" | "general" | … */
  domain: string;
  toolClass: ToolClass;
  /** Service name shown on cards and in Activity, e.g. "Gmail". */
  service: string;
  input: z.ZodType<I>;
  /** Short present-tense label for the step timeline, e.g. "Reading thread". */
  label?: (input: I) => string;
  /** `act` tools: build the approval card from validated input. Must not have side effects. */
  preview?: (input: I, ctx: ToolContext) => ActPreview | Promise<ActPreview>;
  /** Money actions always need explicit approval, even with an "Always allow" rule. */
  involvesMoney?: boolean | ((input: I) => boolean);
  /** Output comes from outside sources (email bodies, web pages) and must be treated as data. */
  untrustedOutput?: boolean;
  /** Per-call timeout override in ms. */
  timeoutMs?: number;
  run(input: I, ctx: ToolContext): Promise<O>;
  /** Rich UI parts (payment QR, links) to attach to the assistant's reply. */
  toParts?: (output: O, input: I) => MessagePart[];
}

export const defineTool = <I, O>(def: ToolDef<I, O>): ToolDef<I, O> => def;
