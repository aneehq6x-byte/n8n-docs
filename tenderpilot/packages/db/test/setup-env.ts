import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Load the repo-root .env for local runs; CI provides DATABASE_URL directly.
const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
