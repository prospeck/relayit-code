import { useSyncExternalStore } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = globalThis.window?.matchMedia?.(REDUCED_MOTION);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

const readReducedMotion = () => globalThis.window?.matchMedia?.(REDUCED_MOTION).matches ?? false;

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
}
