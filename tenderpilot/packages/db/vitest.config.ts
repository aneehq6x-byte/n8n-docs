import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./test/setup-env.ts"],
    // Integration tests share one Postgres; run files serially.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
