import { z } from "zod";

/* ───────────── Tools & approvals ───────────── */

export const ToolClass = z.enum(["read", "prepare", "act"]);
export type ToolClass = z.infer<typeof ToolClass>;

export const ActionStatus = z.enum([
  "pending",
  "approved",
  "refused",
  "expired",
  "executed",
  "failed",
]);
export type ActionStatus = z.infer<typeof ActionStatus>;

/** A detail row on an approval card, e.g. { label: "To", value: "Priya" }. */
export const CardDetail = z.object({ label: z.string(), value: z.string() });
export type CardDetail = z.infer<typeof CardDetail>;

export const PendingAction = z.object({
  id: z.string(),
  runId: z.string(),
  conversationId: z.string(),
  toolName: z.string(),
  /** Short imperative, e.g. "Send email to Priya". */
  title: z.string(),
  /** One or two sentences of what will happen. */
  summary: z.string(),
  /** The service doing it: "Gmail", "Swiggy", "Demo". */
  service: z.string(),
  recipient: z.string().nullable(),
  amountInr: z.number().nullable(),
  details: z.array(CardDetail),
  payload: z.unknown(),
  status: ActionStatus,
  /** True when outside content (email, web page) was read earlier in this run. */
  tainted: z.boolean(),
  /** Money actions can never be auto-approved. */
  involvesMoney: z.boolean(),
  spendCapInr: z.number().nullable(),
  idempotencyKey: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  result: z.unknown().nullable(),
});
export type PendingAction = z.infer<typeof PendingAction>;

export const ApprovalRule = z.object({
  id: z.string(),
  toolName: z.string(),
  service: z.string(),
  label: z.string(),
  createdAt: z.string(),
});
export type ApprovalRule = z.infer<typeof ApprovalRule>;

export const ApproveRequest = z.object({ mode: z.enum(["once", "always"]) });

/* ───────────── Profile & settings ───────────── */

export const Address = z.object({
  id: z.string(),
  label: z.string().min(1),
  line: z.string().min(1),
  city: z.string().optional().default(""),
  pincode: z.string().optional().default(""),
});
export type Address = z.infer<typeof Address>;

export const Profile = z.object({
  name: z.string().min(1),
  city: z.string().min(1),
  addresses: z.array(Address),
});
export type Profile = z.infer<typeof Profile>;

export const ProviderId = z.enum(["anthropic", "openai", "gemini", "openrouter", "ollama"]);
export type ProviderId = z.infer<typeof ProviderId>;

export const ModelConfig = z.object({
  provider: ProviderId,
  model: z.string().min(1),
  baseUrl: z.string().optional(),
  /** Optional cheaper model on the same provider for routing and summaries. */
  routerModel: z.string().optional(),
});
export type ModelConfig = z.infer<typeof ModelConfig>;

export const Settings = z.object({
  spendCapInr: z.number().int().positive().default(2000),
  briefTime: z.string().regex(/^\d{2}:\d{2}$/).default("08:30"),
  briefOnFirstOpen: z.boolean().default(true),
  notifications: z.boolean().default(true),
  quickAskShortcut: z.string().default("Alt+Space"),
  browserAgentEnabled: z.boolean().default(true),
  browserHeadless: z.boolean().default(false),
});
export type Settings = z.infer<typeof Settings>;

export const OnboardingRequest = z.object({
  profile: Profile,
  model: ModelConfig,
  apiKey: z.string().optional(),
});
export type OnboardingRequest = z.infer<typeof OnboardingRequest>;

export const ValidateKeyRequest = z.object({
  provider: ProviderId,
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});

export type ValidateKeyResult = { ok: boolean; error?: string; models: string[] };

export type AppState = {
  onboarded: boolean;
  profile: Profile | null;
  model: ModelConfig | null;
  /** Never contains the key itself. */
  keySaved: boolean;
  settings: Settings;
  version: string;
  mockMode: { model: boolean; google: boolean };
};

/* ───────────── Chat ───────────── */

export const MessagePart = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("choices"),
    question: z.string().optional(),
    options: z.array(z.string()),
  }),
  z.object({ type: z.literal("action"), actionId: z.string() }),
  z.object({
    type: z.literal("steps"),
    steps: z.array(z.object({ label: z.string(), tool: z.string(), status: z.string() })),
  }),
  z.object({
    type: z.literal("payment"),
    orderId: z.string(),
    upiUri: z.string(),
    qrSvg: z.string(),
    checkoutUrl: z.string().nullable(),
    amountInr: z.number(),
    payee: z.string(),
  }),
  z.object({
    type: z.literal("link"),
    url: z.string(),
    title: z.string(),
    subtitle: z.string().optional(),
  }),
  z.object({
    type: z.literal("sources"),
    sources: z.array(z.object({ url: z.string(), title: z.string() })),
  }),
]);
export type MessagePart = z.infer<typeof MessagePart>;

export type Message = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  createdAt: string;
  usage?: { inputTokens: number; outputTokens: number; costInr: number | null } | null;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  kind: "chat" | "brief" | "routine";
};

export const SendMessageRequest = z.object({
  text: z.string().min(1).max(20000),
  skill: z.string().optional(),
});

/* ───────────── Activity ───────────── */

export type AuditEvent = {
  id: string;
  ts: string;
  kind:
    | "tool.call"
    | "tool.result"
    | "action.created"
    | "action.approved"
    | "action.refused"
    | "action.executed"
    | "action.failed"
    | "action.expired"
    | "settings.changed"
    | "secret.saved"
    | "secret.deleted"
    | "connection.changed"
    | "routine.run"
    | "error";
  toolName: string | null;
  toolClass: ToolClass | null;
  summary: string;
  data: unknown;
  conversationId: string | null;
};

/* ───────────── Tasks ───────────── */

export const TaskStatus = z.enum(["needs_you", "working", "review", "done"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export type Task = {
  id: string;
  title: string;
  detail: string;
  status: TaskStatus;
  source: string;
  sourceRef: string | null;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
};

/* ───────────── Connections (MCP) ───────────── */

export const McpTransport = z.enum(["stdio", "http"]);
export const McpServerInput = z.object({
  name: z.string().min(1),
  transport: McpTransport,
  command: z.string().optional(),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string(), z.string()).optional().default({}),
  url: z.string().url().optional(),
  domain: z.string().optional().default("general"),
});
export type McpServerInput = z.infer<typeof McpServerInput>;

export type McpServer = {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command: string | null;
  args: string[];
  url: string | null;
  domain: string;
  enabled: boolean;
  builtin: boolean;
  status: "connected" | "disconnected" | "error" | "needs_auth" | "connecting";
  error: string | null;
  tools: McpTool[];
};

export type McpTool = {
  name: string;
  description: string;
  toolClass: ToolClass;
  enabled: boolean;
};

/* ───────────── Skills & routines ───────────── */

export const SkillInput = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers and dashes"),
  title: z.string().min(1),
  description: z.string().default(""),
  instructions: z.string().min(1),
  domains: z.array(z.string()).default([]),
});
export type SkillInput = z.infer<typeof SkillInput>;
export type Skill = SkillInput & { id: string; builtin: boolean; updatedAt: string };

export const RoutineInput = z.object({
  title: z.string().min(1),
  prompt: z.string().min(1),
  /** 5-field cron expression in the user's local time. */
  cron: z.string().min(9),
  enabled: z.boolean().default(true),
});
export type RoutineInput = z.infer<typeof RoutineInput>;
export type Routine = RoutineInput & {
  id: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "ok" | "error" | null;
  createdAt: string;
};
export type RoutineRun = {
  id: string;
  routineId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "ok" | "error";
  conversationId: string | null;
  error: string | null;
};

/* ───────────── Memory ───────────── */

export const MemoryCategory = z.enum(["preference", "person", "place", "order", "travel", "other"]);
export const MemoryFactInput = z.object({
  category: MemoryCategory,
  key: z.string().min(1),
  value: z.string().min(1),
});
export type MemoryFactInput = z.infer<typeof MemoryFactInput>;
export type MemoryFact = MemoryFactInput & {
  id: string;
  source: "user" | "agent";
  updatedAt: string;
};

/* ───────────── Live events (WebSocket) ───────────── */

export type ServerEvent =
  | { type: "run.started"; runId: string; conversationId: string }
  | { type: "run.status"; runId: string; conversationId: string; label: string }
  | { type: "run.text"; runId: string; conversationId: string; delta: string }
  | {
      type: "run.step";
      runId: string;
      conversationId: string;
      step: { id: string; label: string; tool: string; status: "running" | "done" | "error" | "waiting" };
    }
  | { type: "run.finished"; runId: string; conversationId: string }
  | { type: "run.error"; runId: string; conversationId: string; error: string }
  | { type: "message.created"; message: Message }
  | { type: "conversation.updated"; conversation: Conversation }
  | { type: "action.pending"; action: PendingAction }
  | { type: "action.updated"; action: PendingAction }
  | { type: "audit"; event: AuditEvent }
  | { type: "tasks.updated" }
  | { type: "connections.updated" }
  | { type: "routines.updated" }
  | { type: "browser.frame"; conversationId: string; url: string; jpegBase64: string }
  | { type: "notify"; title: string; body: string; kind: "needs_you" | "order" | "routine" | "info" };

export const SERVICE_COLORS: Record<string, string> = {
  Gmail: "#EA4335",
  Calendar: "#4285F4",
  Swiggy: "#FC8019",
  Zomato: "#E23744",
  Zepto: "#7B2FF7",
  Blinkit: "#F8CB46",
  Uber: "#000000",
  IRCTC: "#1F4E9E",
  "Namma Metro": "#7A2C8E",
  RelayIt: "#E8572A",
};

export function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}
export * from "./tools.ts";
