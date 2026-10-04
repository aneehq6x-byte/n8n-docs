import { MockEtimadConnector, type TenderConnector } from "@tenderpilot/core";
import { getServerEnv } from "@tenderpilot/config";

/**
 * Connector registry, driven by `SCOUT_CONNECTORS`. Real portals are added
 * here as `GenericGovConnector` instances with a portal-specific `mapRecord`
 * and credentials from the secrets abstraction.
 */
const REGISTRY: Record<string, () => TenderConnector> = {
  "etimad-mock": () => new MockEtimadConnector(),
};

export function buildConnectors(spec: string = getServerEnv().SCOUT_CONNECTORS): TenderConnector[] {
  const keys = spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = keys.filter((k) => !(k in REGISTRY));
  if (unknown.length > 0) {
    throw new Error(`Unknown SCOUT_CONNECTORS: ${unknown.join(", ")} (known: ${Object.keys(REGISTRY).join(", ")})`);
  }
  return keys.map((k) => {
    const factory = REGISTRY[k];
    if (!factory) throw new Error(`connector ${k} missing`);
    return factory();
  });
}

export function scoutSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - getServerEnv().SCOUT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
}
