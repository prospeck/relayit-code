// Usuals: the things a person asks for again and again, one tap from Today. Kept on this computer. A fresh install
// starts with a few that show what RelayIt does; once someone saves their own, theirs lead.
import { useSyncExternalStore } from "react";
import { t } from "@/lib/i18n";

export interface Usual {
  label: string;
  text: string;
}

const KEY = "relayit-usuals";
export const USUALS_LIMIT = 8;
const listeners = new Set<() => void>();
let cache: { raw: string | null; usuals: Usual[] } | null = null;

function read(): Usual[] {
  let raw: string | null = null;
  try { raw = globalThis.localStorage?.getItem(KEY) ?? null; } catch { raw = null; }
  if (cache && cache.raw === raw) return cache.usuals;
  let saved: Usual[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      saved = parsed.filter((item): item is Usual =>
        Boolean(item) && typeof item.label === "string" && typeof item.text === "string" && item.text.trim().length > 0).slice(0, USUALS_LIMIT);
    }
  } catch {
    saved = [];
  }
  cache = { raw, usuals: saved };
  return saved;
}

function write(usuals: Usual[]): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(usuals.slice(0, USUALS_LIMIT))); } catch {}
  for (const listener of listeners) listener();
}

export function starterUsuals(): Usual[] {
  return [
    { label: t("relay.usual.food.label"), text: t("relay.usual.food.text") },
    { label: t("relay.usual.day.label"), text: t("relay.usual.day.text") },
    { label: t("relay.usual.mail.label"), text: t("relay.usual.mail.text") },
    { label: t("relay.usual.train.label"), text: t("relay.usual.train.text") },
  ];
}

/** A short label from what someone asked: its first few words. */
export function usualLabel(text: string): string {
  const words = text.trim().replace(/\s+/g, " ").split(" ");
  const short = words.slice(0, 5).join(" ");
  return words.length > 5 ? `${short}…` : short;
}

export function saveUsual(text: string, label = usualLabel(text)): void {
  const clean = text.trim();
  if (!clean) return;
  write([{ label, text: clean }, ...read().filter((usual) => usual.text !== clean)]);
}

export function removeUsual(text: string): void {
  write(read().filter((usual) => usual.text !== text));
}

export function isUsual(text: string): boolean {
  return read().some((usual) => usual.text === text.trim());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const storage = (event: StorageEvent) => { if (event.key === KEY) listener(); };
  window.addEventListener("storage", storage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", storage); };
}

/** Saved usuals, or the starters while there are none. */
export function useUsuals(): Usual[] {
  const saved = useSyncExternalStore(subscribe, read, () => []);
  return saved.length ? saved : starterUsuals();
}
