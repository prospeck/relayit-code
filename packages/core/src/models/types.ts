export type ToolCall = { id: string; name: string; args: unknown; rawArgs: string };

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

export type ModelRequest = {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
  temperature?: number;
  /** Ask for a JSON object reply (used by the router). */
  json?: boolean;
  signal?: AbortSignal;
};

export type ModelEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done"; stopReason: string };

export interface ModelProvider {
  readonly id: string;
  stream(req: ModelRequest): AsyncIterable<ModelEvent>;
  listModels(): Promise<string[]>;
}

export class ModelError extends Error {
  readonly status: number | undefined;
  readonly retryable: boolean;
  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.status = status;
    this.retryable = retryable;
    this.name = "ModelError";
  }
}

/** Collects a full (non-streamed) response. */
export async function complete(provider: ModelProvider, req: ModelRequest) {
  let text = "";
  const toolCalls: ToolCall[] = [];
  let usage = { inputTokens: 0, outputTokens: 0 };
  for await (const ev of provider.stream(req)) {
    if (ev.type === "text") text += ev.delta;
    else if (ev.type === "tool_call") toolCalls.push(ev.call);
    else if (ev.type === "usage")
      usage = {
        inputTokens: usage.inputTokens + ev.inputTokens,
        outputTokens: usage.outputTokens + ev.outputTokens,
      };
  }
  return { text, toolCalls, usage };
}

export function safeJson(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { __unparseable: raw };
  }
}
