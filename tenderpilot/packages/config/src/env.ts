import { z } from "zod";

/**
 * Server-side configuration. Validated lazily on first access (never at import
 * time) so `next build` and type-only imports work without a live environment.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url().default("redis://localhost:6379"),
  NEXTAUTH_SECRET: z.string().min(32, "NEXTAUTH_SECRET must be at least 32 characters"),
  NEXTAUTH_URL: z.url().optional(),
  /** Object storage (MinIO locally, S3-compatible in production) for tender documents. */
  S3_ENDPOINT: z.url().default("http://localhost:9000"),
  S3_BUCKET: z.string().default("tender-documents"),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  /** Which tender connectors the Scout runs, comma separated. */
  SCOUT_CONNECTORS: z.string().default("etimad-mock"),
  /** Cron for the scheduled Scout sweep across all orgs. */
  SCOUT_CRON: z.string().default("0 */6 * * *"),
  /** How far back the Scout looks on each sweep (ingestion is idempotent). */
  SCOUT_LOOKBACK_DAYS: z.coerce.number().int().positive().default(90),
  /** Where secrets come from: plain env, or Azure Key Vault (hydrated at boot). */
  SECRETS_PROVIDER: z.enum(["env", "azure-keyvault"]).default("env"),
  AZURE_KEYVAULT_URL: z.url().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid server environment:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test/dev helper: forget the cached env so the next read re-validates. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
