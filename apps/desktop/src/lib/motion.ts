import { useSyncExternalStore } from "react";

/** Live `prefers-reduced-motion` that also updates when the OS setting changes. */
const query =
  typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      query?.addEventListener("change", cb);
      return () => query?.removeEventListener("change", cb);
    },
    () => query?.matches ?? false,
  );
}
