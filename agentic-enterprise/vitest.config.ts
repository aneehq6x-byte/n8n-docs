import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "agents/**/*.test.ts"],
    environment: "node",
    pool: "forks",
  },
});
