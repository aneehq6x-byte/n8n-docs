import { z } from "zod";

/**
 * Secrets abstraction. Application code never reads credentials from anywhere
 * but `getServerEnv()`; at process boot, `hydrateSecrets()` pulls the named
 * secrets from the configured provider into the environment. Swapping env vars
 * for Azure Key Vault is a config change, not a code change.
 */
export interface SecretProvider {
  readonly name: string;
  getSecret(key: string): Promise<string | undefined>;
}

export class EnvSecretProvider implements SecretProvider {
  readonly name = "env";
  async getSecret(key: string): Promise<string | undefined> {
    return process.env[key];
  }
}

const keyVaultSecretSchema = z.object({ value: z.string() });

export interface KeyVaultOptions {
  vaultUrl: string;
  /** Returns an AAD bearer token for `https://vault.azure.net` (managed identity / workload identity). */
  getAccessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
}

/**
 * Azure Key Vault over its REST API. Env keys like `DATABASE_URL` map to vault
 * secret names like `DATABASE-URL` (Key Vault disallows underscores).
 */
export class AzureKeyVaultSecretProvider implements SecretProvider {
  readonly name = "azure-keyvault";
  constructor(private readonly opts: KeyVaultOptions) {}

  async getSecret(key: string): Promise<string | undefined> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const secretName = key.replace(/_/g, "-");
    const url = new URL(`/secrets/${encodeURIComponent(secretName)}`, this.opts.vaultUrl);
    url.searchParams.set("api-version", "7.4");
    const res = await doFetch(url, {
      headers: { authorization: `Bearer ${await this.opts.getAccessToken()}` },
    });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`Key Vault returned ${res.status} for ${secretName}`);
    const body: unknown = await res.json();
    return keyVaultSecretSchema.parse(body).value;
  }
}

/** Keys hydrated at boot when a non-env provider is configured. */
export const MANAGED_SECRET_KEYS = [
  "DATABASE_URL",
  "REDIS_URL",
  "NEXTAUTH_SECRET",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "SMTP_URL",
  "MOYASAR_SECRET_KEY",
] as const;

/** Copy secrets from the provider into process.env (existing values win). */
export async function hydrateSecrets(
  provider: SecretProvider,
  keys: readonly string[] = MANAGED_SECRET_KEYS,
): Promise<void> {
  if (provider.name === "env") return;
  for (const key of keys) {
    if (process.env[key]) continue;
    const value = await provider.getSecret(key);
    if (value !== undefined) process.env[key] = value;
  }
}
