import { useSyncExternalStore } from "react";

/** Tiny hash router: #/today, #/chat/<id>, #/settings/model … */
export type Route = { screen: string; param: string | null; sub: string | null };

function parse(): Route {
  const [screen = "today", param = null, sub = null] = window.location.hash
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean);
  return { screen, param, sub };
}

let current = parse();
const listeners = new Set<() => void>();
window.addEventListener("hashchange", () => {
  current = parse();
  listeners.forEach((l) => l());
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function navigate(path: string): void {
  const hash = `#/${path.replace(/^\/?#?\/?/, "")}`;
  if (window.location.hash !== hash) window.location.hash = hash;
}
