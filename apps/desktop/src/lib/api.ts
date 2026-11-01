import type {
  AppState,
  ApprovalRule,
  AuditEvent,
  Conversation,
  McpServer,
  McpServerInput,
  MemoryFact,
  MemoryFactInput,
  Message,
  ModelConfig,
  OnboardingRequest,
  PendingAction,
  Profile,
  ProviderId,
  Routine,
  RoutineInput,
  RoutineRun,
  Settings,
  Skill,
  SkillInput,
  Task,
  TaskStatus,
  ValidateKeyResult,
} from "@relayit/shared";
import { invoke, isTauri } from "./tauri";

type Endpoint = { base: string; token: string };
let endpointPromise: Promise<Endpoint> | null = null;

/** In the desktop app the shell tells us the sidecar's port and per-launch token; in the browser we use the dev core. */
export function endpoint(): Promise<Endpoint> {
  endpointPromise ??= (async () => {
    if (isTauri()) {
      for (let i = 0; i < 100; i++) {
        const e = await invoke<{ port: number; token: string } | null>("core_endpoint");
        if (e) return { base: `http://127.0.0.1:${e.port}`, token: e.token };
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error("RelayIt's engine didn't start. Try restarting the app.");
    }
    return {
      base: import.meta.env.VITE_CORE_URL ?? "http://127.0.0.1:47821",
      token: import.meta.env.VITE_CORE_TOKEN ?? "dev",
    };
  })();
  return endpointPromise;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { base, token } = await endpoint();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, "Can't reach RelayIt's engine.");
  }
  const data = res.headers.get("content-type")?.includes("json")
    ? await res.json()
    : await res.text();
  if (!res.ok)
    throw new ApiError(
      res.status,
      (data as { error?: string })?.error ?? `Request failed (${res.status})`,
    );
  return data as T;
}

const get = <T>(p: string) => req<T>("GET", p);
const post = <T>(p: string, b?: unknown) => req<T>("POST", p, b ?? {});
const put = <T>(p: string, b: unknown) => req<T>("PUT", p, b);
const patch = <T>(p: string, b: unknown) => req<T>("PATCH", p, b);
const del = <T>(p: string) => req<T>("DELETE", p);

export type ConversationDetail = {
  conversation: Conversation;
  messages: Message[];
  actions: PendingAction[];
  busy: boolean;
};
export type ToolInfo = {
  name: string;
  description: string;
  domain: string;
  toolClass: string;
  service: string;
  source: string;
};
export type Brief = { conversationId: string; createdAt: string } | null;
export type TodayData = {
  events: { id: string; title: string; start: string; end: string; location?: string | null }[];
  calendarConnected: boolean;
  orders: { id: string; title: string; amountInr: number; status: string; updatedAt: string }[];
  brief: Brief;
};
export type OllamaPull = {
  model: string;
  status: string;
  completed: number;
  total: number;
  done: boolean;
  error: string | null;
};
export type OllamaInfo = {
  running: boolean;
  models: string[];
  recommended: { name: string; sizeGb: number; label: string };
  pull: OllamaPull | null;
};
export type GoogleStatus = {
  connected: boolean;
  email: string | null;
  mode: "real" | "fake" | "none";
  clientConfigured: boolean;
};
export type GoogleHealth = {
  ok: boolean;
  issues: {
    service: string;
    kind:
      | "api_disabled"
      | "missing_permission"
      | "rate_limited"
      | "other"
      | "reconnect"
      | "unreachable";
    message: string;
    actionUrl?: string;
  }[];
};

export const api = {
  state: () => get<AppState>("/api/state"),
  onboard: (r: OnboardingRequest) => post<AppState>("/api/onboarding", r),
  saveProfile: (p: Profile) => put<Profile>("/api/profile", p),
  saveSettings: (s: Partial<Settings>) => patch<Settings>("/api/settings", s),
  validateKey: (provider: ProviderId, apiKey?: string, baseUrl?: string) =>
    post<ValidateKeyResult>("/api/models/validate", { provider, apiKey, baseUrl }),
  ollama: () => get<OllamaInfo>("/api/models/ollama"),
  pullOllama: (model: string) => post<OllamaPull>("/api/models/ollama/pull", { model }),
  saveModel: (model: ModelConfig, apiKey?: string) =>
    put<AppState>("/api/models/config", { model, apiKey }),
  deleteKey: (provider: ProviderId) => del<AppState>(`/api/models/key/${provider}`),

  conversations: () => get<Conversation[]>("/api/conversations"),
  createConversation: () => post<Conversation>("/api/conversations"),
  conversation: (id: string) => get<ConversationDetail>(`/api/conversations/${id}`),
  deleteConversation: (id: string) => del(`/api/conversations/${id}`),
  send: (id: string, text: string) => post(`/api/conversations/${id}/messages`, { text }),
  stop: (id: string) => post(`/api/conversations/${id}/stop`),

  actions: (status?: string) =>
    get<PendingAction[]>(`/api/actions${status ? `?status=${status}` : ""}`),
  approve: (id: string, mode: "once" | "always") =>
    post<PendingAction>(`/api/actions/${id}/approve`, { mode }),
  refuse: (id: string) => post<PendingAction>(`/api/actions/${id}/refuse`),
  rules: () => get<ApprovalRule[]>("/api/approval-rules"),
  deleteRule: (id: string) => del(`/api/approval-rules/${id}`),

  audit: (q: { before?: string; kind?: string; q?: string } = {}) =>
    get<AuditEvent[]>(
      `/api/audit?${new URLSearchParams(Object.entries({ limit: "150", ...q }).filter(([, v]) => v) as [string, string][])}`,
    ),

  tasks: () => get<Task[]>("/api/tasks"),
  setTask: (id: string, status: TaskStatus) => patch(`/api/tasks/${id}`, { status }),
  deleteTask: (id: string) => del(`/api/tasks/${id}`),
  canWait: () =>
    get<{
      at: string | null;
      items: { threadId: string; subject: string; from: string; reason: string }[];
    }>("/api/google/can-wait"),
  triage: () => post<{ needsYou: number; canWait: number }>("/api/google/triage"),

  memory: () => get<MemoryFact[]>("/api/memory"),
  addMemory: (f: MemoryFactInput) => post<MemoryFact>("/api/memory", f),
  deleteMemory: (id: string) => del(`/api/memory/${id}`),

  tools: () => get<ToolInfo[]>("/api/tools"),
  servers: () => get<McpServer[]>("/api/mcp/servers"),
  addServer: (
    s: Partial<McpServerInput> & {
      name: string;
      transport: "stdio" | "http";
      envSecrets?: Record<string, string>;
    },
  ) => post<McpServer>("/api/mcp/servers", s),
  updateServer: (id: string, patchBody: { enabled?: boolean }) =>
    patch<McpServer>(`/api/mcp/servers/${id}`, patchBody),
  deleteServer: (id: string) => del(`/api/mcp/servers/${id}`),
  reconnectServer: (id: string) => post<McpServer>(`/api/mcp/servers/${id}/reconnect`),
  setToolClass: (serverId: string, tool: string, body: { toolClass?: string; enabled?: boolean }) =>
    patch(`/api/mcp/servers/${serverId}/tools/${encodeURIComponent(tool)}`, body),

  keys: () => get<Record<string, boolean>>("/api/keys"),
  saveKey: (name: string, value: string) => put(`/api/keys/${name}`, { value }),

  google: () => get<GoogleStatus>("/api/google/status"),
  googleHealth: () => get<GoogleHealth>("/api/google/health"),
  connectGoogle: (opts: { fake?: boolean; clientId?: string; clientSecret?: string }) =>
    post<GoogleStatus>("/api/google/connect", opts),
  disconnectGoogle: () => post<GoogleStatus>("/api/google/disconnect"),

  today: () => get<TodayData>("/api/today"),
  brief: (auto = false) =>
    post<{ conversationId: string; created: boolean }>("/api/brief", { auto }),
  presets: () =>
    get<{ id: string; name: string; url: string; domain: string; blurb: string }[]>(
      "/api/mcp/presets",
    ),
  saveRazorpay: (keyId: string, keySecret: string) =>
    put("/api/payments/razorpay", { keyId, keySecret }),

  skills: () => get<Skill[]>("/api/skills"),
  saveSkill: (s: SkillInput) => post<Skill>("/api/skills", s),
  deleteSkill: (id: string) => del(`/api/skills/${id}`),

  routines: () => get<Routine[]>("/api/routines"),
  createRoutine: (r: RoutineInput) => post<Routine>("/api/routines", r),
  updateRoutine: (id: string, r: Partial<RoutineInput>) => patch<Routine>(`/api/routines/${id}`, r),
  deleteRoutine: (id: string) => del(`/api/routines/${id}`),
  runRoutine: (id: string) => post<{ conversationId: string }>(`/api/routines/${id}/run`),
  routineRuns: (id: string) => get<RoutineRun[]>(`/api/routines/${id}/runs`),

  payment: (orderId: string) =>
    get<{ status: string; paidAt: string | null }>(`/api/payments/by-order/${orderId}`),
  confirmUpiPaid: (orderId: string, utr?: string) =>
    post(`/api/payments/by-order/${orderId}/user-confirmed`, { utr }),

  browserSessions: () =>
    get<{ site: string; loggedIn: boolean; lastUsed: string | null }[]>("/api/browser/sessions"),
  openBrowserLogin: (site: string) => post(`/api/browser/login`, { site }),
  saveSiteSecret: (site: string, username: string, password: string) =>
    post(`/api/browser/credentials`, { site, username, password }),

  transcribe: async (audio: Blob): Promise<{ text: string }> => {
    const { base, token } = await endpoint();
    const res = await fetch(`${base}/api/voice/transcribe`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": audio.type || "audio/webm" },
      body: audio,
    });
    const data = await res.json();
    if (!res.ok) throw new ApiError(res.status, data.error ?? "Transcription failed");
    return data;
  },
};
