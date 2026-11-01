import type { ChatMessage, ModelEvent, ModelProvider, ModelRequest } from "./types.ts";
import { ModelError, safeJson } from "./types.ts";
import { readSse, errorFromResponse } from "./sse.ts";

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic";
  private apiKey: string;
  private baseUrl: string;
  constructor(apiKey: string, baseUrl = "https://api.anthropic.com") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private headers() {
    return {
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    };
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/v1/models?limit=100`, { headers: this.headers() });
    if (!res.ok) {
      const e = await errorFromResponse(res, "Anthropic");
      throw new ModelError(e.message, res.status, e.retryable);
    }
    const body = (await res.json()) as { data: { id: string }[] };
    return body.data.map((m) => m.id);
  }

  async *stream(req: ModelRequest): AsyncIterable<ModelEvent> {
    const body = {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: toAnthropic(req.messages, req.json),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters,
            })),
          }
        : {}),
    };
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: req.signal ?? null,
    });
    if (!res.ok) {
      const e = await errorFromResponse(res, "Anthropic");
      throw new ModelError(e.message, res.status, e.retryable);
    }
    const tools = new Map<number, { id: string; name: string; json: string }>();
    let input = 0;
    let output = 0;
    let stop = "end_turn";
    for await (const { data } of readSse(res, req.signal)) {
      const ev = JSON.parse(data) as Record<string, any>;
      switch (ev.type) {
        case "message_start":
          input = ev.message?.usage?.input_tokens ?? 0;
          input += ev.message?.usage?.cache_read_input_tokens ?? 0;
          input += ev.message?.usage?.cache_creation_input_tokens ?? 0;
          break;
        case "content_block_start":
          if (ev.content_block?.type === "tool_use")
            tools.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, json: "" });
          break;
        case "content_block_delta":
          if (ev.delta?.type === "text_delta") yield { type: "text", delta: ev.delta.text };
          else if (ev.delta?.type === "input_json_delta") {
            const t = tools.get(ev.index);
            if (t) t.json += ev.delta.partial_json;
          }
          break;
        case "content_block_stop": {
          const t = tools.get(ev.index);
          if (t) {
            yield {
              type: "tool_call",
              call: { id: t.id, name: t.name, rawArgs: t.json, args: safeJson(t.json) },
            };
            tools.delete(ev.index);
          }
          break;
        }
        case "message_delta":
          if (ev.delta?.stop_reason) stop = ev.delta.stop_reason;
          output = ev.usage?.output_tokens ?? output;
          break;
        case "error":
          throw new ModelError(
            ev.error?.message ?? "Anthropic stream error",
            undefined,
            ev.error?.type === "overloaded_error",
          );
      }
    }
    yield { type: "usage", inputTokens: input, outputTokens: output };
    yield { type: "done", stopReason: stop };
  }
}

function toAnthropic(messages: ChatMessage[], json?: boolean) {
  const out: { role: "user" | "assistant"; content: Block[] }[] = [];
  const push = (role: "user" | "assistant", block: Block) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(block);
    else out.push({ role, content: [block] });
  };
  for (const m of messages) {
    if (m.role === "user") push("user", { type: "text", text: m.content || "(empty)" });
    else if (m.role === "assistant") {
      if (m.content) push("assistant", { type: "text", text: m.content });
      for (const c of m.toolCalls ?? [])
        push("assistant", {
          type: "tool_use",
          id: c.id,
          name: c.name,
          input: c.args && typeof c.args === "object" ? c.args : {},
        });
      if (!m.content && !m.toolCalls?.length)
        push("assistant", { type: "text", text: "(no reply)" });
    } else
      push("user", {
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.content,
        ...(m.isError ? { is_error: true } : {}),
      });
  }
  if (json) push("user", { type: "text", text: "Reply with a single JSON object only." });
  return out;
}
