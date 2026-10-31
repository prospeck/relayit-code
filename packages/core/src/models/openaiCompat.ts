import type { ChatMessage, ModelEvent, ModelProvider, ModelRequest, ToolCall } from "./types.ts";
import { ModelError, safeJson } from "./types.ts";
import { readSse, errorFromResponse } from "./sse.ts";
import { randomUUID } from "node:crypto";

/**
 * One adapter for every OpenAI-compatible Chat Completions endpoint:
 * OpenAI, Google Gemini (OpenAI endpoint), OpenRouter and Ollama.
 */
export class OpenAICompatProvider implements ModelProvider {
  readonly id: string;
  private baseUrl: string;
  private apiKey: string | null;
  private extraHeaders: Record<string, string>;
  constructor(id: string, baseUrl: string, apiKey: string | null, extraHeaders: Record<string, string> = {}) {
    this.id = id;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.extraHeaders = extraHeaders;
  }

  private headers() {
    return {
      "content-type": "application/json",
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      ...this.extraHeaders,
    };
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers() });
    if (!res.ok) {
      const e = await errorFromResponse(res, this.id);
      throw new ModelError(e.message, res.status, e.retryable);
    }
    const body = (await res.json()) as { data?: { id: string }[] };
    return (body.data ?? []).map((m) => m.id.replace(/^models\//, ""));
  }

  async *stream(req: ModelRequest): AsyncIterable<ModelEvent> {
    const body: Record<string, unknown> = {
      model: req.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: toOpenAI(req.system, req.messages),
      ...(req.maxTokens ? { max_completion_tokens: req.maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.json ? { response_format: { type: "json_object" } } : {}),
      ...(req.tools?.length
        ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) }
        : {}),
    };
    // Ollama and some gateways reject max_completion_tokens.
    if (this.id === "ollama" || this.id === "openrouter" || this.id === "gemini") {
      if (body.max_completion_tokens) {
        body.max_tokens = body.max_completion_tokens;
        delete body.max_completion_tokens;
      }
    }
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST", headers: this.headers(), body: JSON.stringify(body), signal: req.signal ?? null,
    });
    if (!res.ok) {
      const e = await errorFromResponse(res, this.id);
      throw new ModelError(e.message, res.status, e.retryable);
    }
    const partial = new Map<number, { id: string; name: string; args: string }>();
    let stop = "stop";
    let usage: { inputTokens: number; outputTokens: number } | null = null;
    for await (const { data } of readSse(res, req.signal)) {
      if (data === "[DONE]") break;
      const chunk = JSON.parse(data) as Record<string, any>;
      if (chunk.error) throw new ModelError(chunk.error.message ?? `${this.id} stream error`);
      if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 };
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content) yield { type: "text", delta: delta.content };
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const cur = partial.get(idx) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        partial.set(idx, cur);
      }
      if (choice.finish_reason) stop = choice.finish_reason;
    }
    for (const [, t] of [...partial.entries()].sort((a, b) => a[0] - b[0])) {
      const call: ToolCall = { id: t.id || `call_${randomUUID().slice(0, 8)}`, name: t.name, rawArgs: t.args, args: safeJson(t.args) };
      yield { type: "tool_call", call };
    }
    if (usage) yield { type: "usage", ...usage };
    yield { type: "done", stopReason: stop };
  }
}

function toOpenAI(system: string, messages: ChatMessage[]) {
  const out: Record<string, unknown>[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant")
      out.push({
        role: "assistant",
        content: m.content || null,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.rawArgs || JSON.stringify(c.args ?? {}) } })) }
          : {}),
      });
    else out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
  }
  return out;
}
