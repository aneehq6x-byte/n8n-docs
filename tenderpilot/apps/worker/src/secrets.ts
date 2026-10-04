import { AzureKeyVaultSecretProvider, EnvSecretProvider, hydrateSecrets, type SecretProvider } from "@tenderpilot/config";

/** Resolve secrets before anything reads the environment. */
export async function bootSecrets(): Promise<void> {
  await hydrateSecrets(selectProvider());
}

function selectProvider(): SecretProvider {
  if (process.env.SECRETS_PROVIDER !== "azure-keyvault") return new EnvSecretProvider();
  const vaultUrl = process.env.AZURE_KEYVAULT_URL;
  if (!vaultUrl) throw new Error("AZURE_KEYVAULT_URL is required when SECRETS_PROVIDER=azure-keyvault");
  return new AzureKeyVaultSecretProvider({
    vaultUrl,
    // Workload/managed identity: the platform injects a token file or IMDS endpoint.
    getAccessToken: async () => {
      const token = process.env.AZURE_ACCESS_TOKEN;
      if (!token) throw new Error("No Azure access token available (configure managed identity)");
      return token;
    },
  });
}
