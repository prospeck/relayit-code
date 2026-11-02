import type { AppConfig } from "./config.ts";

/** Credentials are write-only, including partial values. */
export function keyHint(_secret: string | undefined | null): { last4?: string } {
  return {};
}

export function keyStatus(secret: string | undefined | null): { configured: boolean; last4?: string } {
  return { configured: Boolean(secret?.trim()), ...keyHint(secret) };
}

export function nestedKeyStatus(cfg: AppConfig) {
  return {
    ttsKey: keyStatus(cfg.tts?.key),
    fishAudioKey: keyStatus(cfg.tts?.fishKey),
    jevApiKey: keyStatus(cfg.decider?.key),
    openrouterDeciderKey: keyStatus(cfg.decider?.openrouterKey),
    workersAiToken: keyStatus(cfg.decider?.workersAiToken),
    openaiImageApiKey: keyStatus(cfg.imageGen?.key),
    customImageApiKey: keyStatus(cfg.imageGen?.customApiKey),
    openaiLiveKey: keyStatus(cfg.live?.key),
  };
}

export function withoutKeyHints<T>(status: T): T {
  if (Array.isArray(status)) return status.map(withoutKeyHints) as T;
  if (!status || typeof status !== "object") return status;
  return Object.fromEntries(Object.entries(status).flatMap(([name, value]) => name === "last4" ? [] : [[name, withoutKeyHints(value)]])) as T;
}
