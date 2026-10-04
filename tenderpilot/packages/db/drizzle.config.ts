import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://tenderpilot:tenderpilot@localhost:5432/tenderpilot",
  },
  strict: true,
  verbose: true,
});
