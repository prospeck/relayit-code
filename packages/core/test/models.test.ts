import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "../src/models/anthropic.ts";
import { OpenAICompatProvider } from "../src/models/openaiCompat.ts";
import { rankModels } from "../src/models/index.ts";
import { estimateCostInr } from "../src/models/pricing.ts";
import { ModelError, type ModelEvent, type ModelProvider, type ModelRequest } from "../src/models/types.ts";
import { localServer } from "./helpers/fixtures.ts";

const request: ModelRequest = {
  model: "test-chat", system: "Test system", messages: [{ role: "user", content: "Hello" }],
  tools: [{ name: "lookup", description: "Look up a value", parameters: { type: "object", properties: { value: { type: "string" } } } }],
};
async function collect(provider: ModelProvider): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of provider.stream(request)) events.push(event);
  return events;
}

function sseHandler(frames: unknown[], received: { path?: string; body?: Record<string, unknown> }, done = false) {
  return (req: IncomingMessage, res: ServerResponse) => {
    received.path = req.url;
    let body = "";
    req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end", () => {
      received.body = JSON.parse(body);
      res.writeHead(200, { "content-type": "text/event-stream" });
      // Split every SSE frame across HTTP writes, including inside JSON tokens.
      for (const frame of frames) {
        const encoded = `data: ${JSON.stringify(frame)}\r\n\r\n`;
        const middle = Math.floor(encoded.length / 2);
        res.write(encoded.slice(0, middle));
        res.write(encoded.slice(middle));
      }
      res.end(done ? "data: [DONE]\r\n\r\n" : "");
    });
  };
}

const providers = [
  { name: "Anthropic", create: (url: string) => new AnthropicProvider("synthetic-key", url) },
  { name: "OpenAI", create: (url: string) => new OpenAICompatProvider("openai", url, "synthetic-key") },
];

describe("model streaming adapters", () => {
  it("decodes Anthropic text, fragmented tool JSON, usage and stop reason", async () => {
    const received: { path?: string; body?: Record<string, unknown> } = {};
    const base = await localServer(sseHandler([
      { type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool_1", name: "lookup", input: {} } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"val' } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: 'ue":"hello"}' } },
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } },
      { type: "message_stop" },
    ], received));
    expect(await collect(new AnthropicProvider("synthetic-key", base))).toEqual([
      { type: "text", delta: "Hello " }, { type: "text", delta: "world" },
      { type: "tool_call", call: { id: "tool_1", name: "lookup", args: { value: "hello" }, rawArgs: '{"value":"hello"}' } },
      { type: "usage", inputTokens: 15, outputTokens: 7 }, { type: "done", stopReason: "tool_use" },
    ]);
    expect(received.path).toBe("/v1/messages");
    expect(received.body).toMatchObject({ model: "test-chat", stream: true, system: [{ type: "text", text: "Test system" }], tools: [{ name: "lookup", input_schema: request.tools![0]!.parameters }] });
  });

  it("decodes OpenAI deltas, interleaved indexed tool calls, usage-only chunk and DONE", async () => {
    const received: { path?: string; body?: Record<string, unknown> } = {};
    const chunk = (delta: unknown, finish_reason: string | null = null) => ({ choices: [{ delta, finish_reason }] });
    const base = await localServer(sseHandler([
      chunk({ content: "Hello " }), chunk({ content: "world" }),
      chunk({ tool_calls: [
        { index: 1, id: "tool_2", function: { name: "sec", arguments: '{"b":' } },
        { index: 0, id: "tool_1", function: { name: "look", arguments: '{"val' } },
      ] }),
      chunk({ tool_calls: [{ index: 0, function: { name: "up", arguments: 'ue":"hello"}' } }] }),
      chunk({ tool_calls: [{ index: 1, function: { name: "ond", arguments: "2}" } }] }),
      chunk({}, "tool_calls"), { choices: [], usage: { prompt_tokens: 11, completion_tokens: 8 } },
    ], received, true));
    expect(await collect(new OpenAICompatProvider("openai", base, "synthetic-key"))).toEqual([
      { type: "text", delta: "Hello " }, { type: "text", delta: "world" },
      { type: "tool_call", call: { id: "tool_1", name: "lookup", args: { value: "hello" }, rawArgs: '{"value":"hello"}' } },
      { type: "tool_call", call: { id: "tool_2", name: "second", args: { b: 2 }, rawArgs: '{"b":2}' } },
      { type: "usage", inputTokens: 11, outputTokens: 8 }, { type: "done", stopReason: "tool_calls" },
    ]);
    expect(received.path).toBe("/chat/completions");
    expect(received.body).toMatchObject({ stream: true, stream_options: { include_usage: true }, messages: [{ role: "system", content: "Test system" }, ...request.messages] });
  });

  for (const provider of providers) {
    // BUG: listModels() discards errorFromResponse.retryable in both adapters.
    it.fails.each([429, 503])(`${provider.name} preserves retryability when listing models returns %i`, async (status) => {
      const base = await localServer((_req, res) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Temporary provider error" } }));
      });
      await expect(provider.create(base).listModels()).rejects.toMatchObject({ status, retryable: true });
    });
    it.each([
      [401, false, "API key was rejected"], [403, false, "access"], [404, false, "wasn't found"],
      [429, true, "rate-limiting"], [500, true, "500"], [503, true, "503"],
    ] as const)(`${provider.name} maps HTTP %i to a friendly stream error`, async (status, retryable, message) => {
      const base = await localServer((_req, res) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Synthetic provider detail" } }));
      });
      const result = collect(provider.create(base));
      await expect(result).rejects.toBeInstanceOf(ModelError);
      await expect(result).rejects.toMatchObject({ status, retryable, message: expect.stringContaining(message) });
    });
  }
});

describe("model selection and estimates", () => {
  it("ranks chat models first, deduplicates and drops embeddings", () => {
    const models = rankModels("openai", ["text-embedding-3-small", "gpt-4.1-mini", "gpt-4.1", "gpt-4.1", "whisper-1", "legacy-completion"]);
    expect(models).toEqual(["gpt-4.1", "gpt-4.1-mini", "legacy-completion"]);
  });
  it("returns zero for Ollama and null for unknown model pricing", () => {
    expect(estimateCostInr("ollama", "unknown-local", 10000, 2000)).toBe(0);
    expect(estimateCostInr("openai", "unknown-model", 10000, 2000)).toBeNull();
    expect(estimateCostInr("anthropic", "claude-sonnet", 1000000, 1000000)).toBe(1584);
  });
});
