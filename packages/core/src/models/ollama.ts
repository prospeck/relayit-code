import { randomUUID } from "node:crypto";
import { Agent } from "undici";

// Loading a local model can take minutes on small machines; don't give up on headers/body after 5 min.
const patient = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
import type { ChatMessage, ModelEvent, ModelProvider, ModelRequest } from "./types.ts";
import { ModelError } from "./types.ts";
import { errorFromResponse } from "./sse.ts";

/**
 * Native Ollama chat API (/api/chat) rather than its OpenAI-compatible endpoint, because only the
 * native API lets us (a) raise the context window — Ollama defaults to 4,096 tokens, smaller than
 * RelayIt's system prompt plus tool list — and (b) turn off "thinking", which multiplies latency on
 * small local models without helping tool use.
 */
export class OllamaProvider implements ModelProvider {
  readonly id = "ollama";
  private baseUrl: string;
  private contextLength: number;
  private capabilities = new Map<string, Promise<string[]>>();

  constructor(baseUrl = "http://127.0.0.1:11434", opts: { contextLength?: number } = {}) {
    // Accept the OpenAI-style base URL too (…/v1).
    this.baseUrl = baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
    // Big enough for RelayIt's prompt + routed tools, small enough to stay on the GPU of an 8 GB Mac.
    this.contextLength = opts.contextLength ?? 8192;
  }

  /**
   * Thinking-only models (e.g. qwen3:4b) ignore think:false and leak their reasoning into the reply,
   * so for any thinking-capable model we enable thinking and keep it out of the visible text.
   * Instruct models don't think at all, which is much faster on small machines.
   */
  private async thinkFor(model: string): Promise<boolean> {
    if (!this.capabilities.has(model)) {
      this.capabilities.set(
        model,
        fetch(`${this.baseUrl}/api/show`, { method: "POST", body: JSON.stringify({ model }) })
          .then(async (r) =>
            r.ok ? (((await r.json()) as { capabilities?: string[] }).capabilities ?? []) : [],
          )
          .catch(() => []),
      );
    }
    return (await this.capabilities.get(model)!).includes("thinking") && !/instruct/i.test(model);
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) throw new ModelError((await errorFromResponse(res, "Ollama")).message, res.status);
    const body = (await res.json()) as { models?: { name: string }[] };
    return (body.models ?? []).map((m) => m.name);
  }

  async *stream(req: ModelRequest): AsyncIterable<ModelEvent> {
    const body = {
      model: req.model,
      stream: true,
      think: await this.thinkFor(req.model),
      keep_alive: "30m",
      messages: toOllama(req.system, req.messages, req.json),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
      ...(req.json ? { format: "json" } : {}),
      options: {
        num_ctx: this.contextLength,
        ...(req.maxTokens ? { num_predict: req.maxTokens } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      },
    };
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: req.signal ?? null,
      // @ts-expect-error -- undici dispatcher option on Node's fetch
      dispatcher: patient,
    });
    if (!res.ok || !res.body) {
      const e = await errorFromResponse(res, "Ollama");
      throw new ModelError(e.message, res.status, e.retryable);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let input = 0;
    let output = 0;
    let stop = "stop";
    let calls = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const chunk = JSON.parse(line) as {
            error?: string;
            message?: {
              content?: string;
              tool_calls?: { function: { name: string; arguments: unknown } }[];
            };
            done?: boolean;
            done_reason?: string;
            prompt_eval_count?: number;
            eval_count?: number;
          };
          if (chunk.error) throw new ModelError(chunk.error);
          const m = chunk.message;
          if (m?.content) yield { type: "text", delta: m.content };
          for (const tc of m?.tool_calls ?? []) {
            calls++;
            const args =
              typeof tc.function.arguments === "string"
                ? safeParse(tc.function.arguments)
                : (tc.function.arguments ?? {});
            yield {
              type: "tool_call",
              call: {
                id: `call_${randomUUID().slice(0, 8)}`,
                name: tc.function.name,
                args,
                rawArgs: JSON.stringify(args),
              },
            };
          }
          if (chunk.done) {
            input = chunk.prompt_eval_count ?? 0;
            output = chunk.eval_count ?? 0;
            stop = calls ? "tool_use" : (chunk.done_reason ?? "stop");
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield { type: "usage", inputTokens: input, outputTokens: output };
    yield { type: "done", stopReason: stop };
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { __unparseable: raw };
  }
}

function toOllama(system: string, messages: ChatMessage[], json?: boolean) {
  const out: Record<string, unknown>[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant")
      out.push({
        role: "assistant",
        content: m.content ?? "",
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                function: { name: c.name, arguments: c.args ?? {} },
              })),
            }
          : {}),
      });
    else out.push({ role: "tool", tool_name: m.name, content: m.content });
  }
  if (json) out.push({ role: "user", content: "Reply with a single JSON object only." });
  return out;
}
