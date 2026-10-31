import { defineConfig } from "vitest/config";

// Real browser tests: allow for a cold Chrome start.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });
