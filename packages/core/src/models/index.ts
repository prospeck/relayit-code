import type { ModelConfig, ProviderId, ValidateKeyResult } from "@relayit/shared";
import { AnthropicProvider } from "./anthropic.ts";
import { OpenAICompatProvider } from "./openaiCompat.ts";
import { MockProvider } from "./mock.ts";
import { OllamaProvider } from "./ollama.ts";
import type { ModelProvider } from "./types.ts";
import { errMessage } from "../util/time.ts";

export * from "./types.ts";
export { MockProvider } from "./mock.ts";
export { estimateCostInr } from "./pricing.ts";

export const DEFAULT_BASE_URLS: Record<ProviderId, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://127.0.0.1:11434",
};

export function createProvider(
  provider: ProviderId | "mock",
  apiKey: string | null,
  baseUrl?: string,
): ModelProvider {
  const base = baseUrl || (provider === "mock" ? "" : DEFAULT_BASE_URLS[provider]);
  switch (provider) {
    case "mock":
      return new MockProvider();
    case "anthropic":
      if (!apiKey) throw new Error("Anthropic needs an API key");
      return new AnthropicProvider(apiKey, base);
    case "openrouter":
      if (!apiKey) throw new Error("OpenRouter needs an API key");
      return new OpenAICompatProvider("openrouter", base, apiKey, {
        "HTTP-Referer": "https://relayit.app",
        "X-Title": "RelayIt",
      });
    case "ollama":
      return new OllamaProvider(base);
    case "openai":
    case "gemini":
      if (!apiKey) throw new Error(`${provider} needs an API key`);
      return new OpenAICompatProvider(provider, base, apiKey);
  }
}

/** Cheap validation: list models (free on every provider). */
export async function validateKey(
  provider: ProviderId,
  apiKey: string | undefined,
  baseUrl?: string,
): Promise<ValidateKeyResult> {
  try {
    const p = createProvider(provider, apiKey ?? null, baseUrl);
    const models = await p.listModels();
    return { ok: true, models: rankModels(provider, models) };
  } catch (e) {
    const msg = errMessage(e);
    const offline = /fetch failed|ECONNREFUSED/i.test(msg);
    return {
      ok: false,
      models: [],
      error: offline
        ? provider === "ollama"
          ? "Ollama isn't running. Install it from ollama.com and start it, then try again."
          : "Couldn't reach the provider. Check your internet connection."
        : msg,
    };
  }
}

/** Puts sensible chat models first so the picker's default is good. */
export function rankModels(provider: ProviderId, models: string[]): string[] {
  const score = (m: string): number => {
    const s = m.toLowerCase();
    if (
      /embed|whisper|tts|dall|image|audio|realtime|moderation|transcribe|search|vision-preview/.test(
        s,
      )
    )
      return -100;
    let v = 0;
    if (provider === "anthropic")
      v += /sonnet/.test(s) ? 30 : /opus/.test(s) ? 20 : /haiku/.test(s) ? 10 : 0;
    if (provider === "openai") v += /^gpt-/.test(s) ? 20 : /^o\d/.test(s) ? 10 : -50;
    if (provider === "gemini") v += /gemini/.test(s) ? 20 : -50;
    // Local: instruct models answer directly; thinking-only builds are many times slower on laptops.
    if (provider === "ollama")
      v += /instruct/.test(s) ? 25 : /qwen3|llama3\.[1-3]|mistral|gemma3/.test(s) ? 10 : 0;
    if (/mini|flash|haiku|small|nano|lite/.test(s)) v -= 3;
    if (/preview|exp|\d{4}-\d{2}-\d{2}/.test(s)) v -= 2;
    const ver = /(\d+(?:\.\d+)?)/.exec(s.replace(/-/g, "."));
    if (ver) v += Math.min(parseFloat(ver[1]!), 20) / 2;
    return v;
  };
  return [...new Set(models)].filter((m) => score(m) > -100).sort((a, b) => score(b) - score(a));
}

/** Picks a cheap model from the same provider for routing, if the user didn't set one. */
export function suggestRouterModel(cfg: ModelConfig, available: string[]): string | undefined {
  if (cfg.routerModel) return cfg.routerModel;
  const cheap = available.find(
    (m) => /haiku|mini|flash|nano|lite/i.test(m) && !/embed|audio|image/i.test(m),
  );
  return cheap;
}

export async function detectOllama(
  baseUrl = "http://127.0.0.1:11434",
): Promise<{ running: boolean; models: string[] }> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { running: false, models: [] };
    const body = (await res.json()) as { models?: { name: string }[] };
    return { running: true, models: (body.models ?? []).map((m) => m.name) };
  } catch {
    return { running: false, models: [] };
  }
}

/** The model RelayIt offers to download for local use: fast, good at tool calls, fits 8 GB Macs. */
export const RECOMMENDED_OLLAMA_MODEL = {
  name: "qwen3:4b-instruct",
  sizeGb: 2.5,
  label: "Qwen 3 4B Instruct",
};

type PullState = {
  model: string;
  status: string;
  completed: number;
  total: number;
  done: boolean;
  error: string | null;
};
let pull: PullState | null = null;

/** Starts (or reports) a background `ollama pull`. One pull at a time. */
export function ollamaPull(model: string, baseUrl = "http://127.0.0.1:11434"): PullState {
  if (pull && !pull.done) return pull;
  pull = { model, status: "starting", completed: 0, total: 0, done: false, error: null };
  const state = pull;
  void (async () => {
    try {
      const res = await fetch(`${baseUrl}/api/pull`, {
        method: "POST",
        body: JSON.stringify({ model, stream: true }),
      });
      if (!res.ok || !res.body) throw new Error(`Ollama returned ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as {
            status?: string;
            completed?: number;
            total?: number;
            error?: string;
          };
          if (ev.error) throw new Error(ev.error);
          if (ev.status) state.status = ev.status;
          if (ev.total) {
            state.total = ev.total;
            state.completed = ev.completed ?? 0;
          }
        }
      }
      state.status = "success";
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
    } finally {
      state.done = true;
    }
  })();
  return state;
}

export function ollamaPullStatus(): PullState | null {
  return pull;
}
