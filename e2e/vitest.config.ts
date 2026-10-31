import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
    expect: { poll: { timeout: 5_000, interval: 50 } },
  },
});
