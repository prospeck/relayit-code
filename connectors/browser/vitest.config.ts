import { defineConfig } from "vitest/config";

// Real browser tests: allow for cold Chrome starts, including close/restart under CPU load.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 30_000 } });
