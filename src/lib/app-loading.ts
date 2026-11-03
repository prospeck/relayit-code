import type { LocaleKey } from "@/locales";

/** Show an empty state only after bots have loaded; developer builds also name the server command. */
export function loadingLine({ connected, hydrated, developer }: {
  connected: boolean; hydrated: boolean; developer: boolean;
}): { text: LocaleKey; busy: boolean; command: boolean } {
  if (connected && hydrated) return { text: "app.loading.noBots", busy: false, command: false };
  return { text: "app.loading.connecting", busy: true, command: developer && !connected };
}
