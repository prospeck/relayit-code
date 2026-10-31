import type { ModelConfig, ProviderId, ValidateKeyResult } from "@relayit/shared";
import { AnthropicProvider } from "./anthropic.ts";
import { OpenAICompatProvider } from "./openaiCompat.ts";
import { MockProvider } from "./mock.ts";
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
  ollama: "http://127.0.0.1:11434/v1",
};

export function createProvider(provider: ProviderId | "mock", apiKey: string | null, baseUrl?: string): ModelProvider {
  const base = baseUrl || (provider === "mock" ? "" : DEFAULT_BASE_URLS[provider]);
  switch (provider) {
    case "mock":
      return new MockProvider();
    case "anthropic":
      if (!apiKey) throw new Error("Anthropic needs an API key");
      return new AnthropicProvider(apiKey, base);
    case "openrouter":
      if (!apiKey) throw new Error("OpenRouter needs an API key");
      return new OpenAICompatProvider("openrouter", base, apiKey, { "HTTP-Referer": "https://relayit.app", "X-Title": "RelayIt" });
    case "ollama":
      return new OpenAICompatProvider("ollama", base, null);
    case "openai":
    case "gemini":
      if (!apiKey) throw new Error(`${provider} needs an API key`);
      return new OpenAICompatProvider(provider, base, apiKey);
  }
}

/** Cheap validation: list models (free on every provider). */
export async function validateKey(provider: ProviderId, apiKey: string | undefined, baseUrl?: string): Promise<ValidateKeyResult> {
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
    if (/embed|whisper|tts|dall|image|audio|realtime|moderation|transcribe|search|vision-preview/.test(s)) return -100;
    let v = 0;
    if (provider === "anthropic") v += /sonnet/.test(s) ? 30 : /opus/.test(s) ? 20 : /haiku/.test(s) ? 10 : 0;
    if (provider === "openai") v += /^gpt-/.test(s) ? 20 : /^o\d/.test(s) ? 10 : -50;
    if (provider === "gemini") v += /gemini/.test(s) ? 20 : -50;
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
  const cheap = available.find((m) => /haiku|mini|flash|nano|lite/i.test(m) && !/embed|audio|image/i.test(m));
  return cheap;
}

export async function detectOllama(baseUrl = "http://127.0.0.1:11434"): Promise<{ running: boolean; models: string[] }> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { running: false, models: [] };
    const body = (await res.json()) as { models?: { name: string }[] };
    return { running: true, models: (body.models ?? []).map((m) => m.name) };
  } catch {
    return { running: false, models: [] };
  }
}
