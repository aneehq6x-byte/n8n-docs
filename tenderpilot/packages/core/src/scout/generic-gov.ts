import { rawTenderSchema, type RawTender } from "../domain/raw-tender";
import type { TenderConnector } from "./connector";

export interface GenericGovConfig {
  source: string;
  /** Base URL of the portal's tender API. */
  baseUrl: string;
  /** API key / token — injected from the env / Key Vault abstraction, never hard-coded. */
  apiKey: string;
  /** Pluggable fetch so the connector is testable. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Request timeout in ms (default 30s). */
  timeoutMs?: number;
  /** Maps one upstream record to a RawTender. The portal-specific shape lives here. */
  mapRecord: (record: unknown) => RawTender;
}

/**
 * Interface-conformant connector for any government portal exposing a JSON
 * tender API. The HTTP call is real; each portal supplies its own `mapRecord`.
 * Output is Zod-validated before it leaves the connector.
 */
export class GenericGovConnector implements TenderConnector {
  readonly source: string;
  private readonly cfg: GenericGovConfig;

  constructor(cfg: GenericGovConfig) {
    this.source = cfg.source;
    this.cfg = cfg;
  }

  async fetchTenders(since: Date): Promise<RawTender[]> {
    const doFetch = this.cfg.fetchImpl ?? fetch;
    const url = new URL("/api/tenders", this.cfg.baseUrl);
    url.searchParams.set("since", since.toISOString());

    const res = await doFetch(url, {
      headers: { authorization: `Bearer ${this.cfg.apiKey}`, accept: "application/json" },
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 30_000),
    });
    if (!res.ok) throw new Error(`${this.source}: upstream returned ${res.status}`);
    const body: unknown = await res.json();
    if (!Array.isArray(body)) throw new Error(`${this.source}: expected a JSON array of tenders`);
    return body.map((r: unknown) => rawTenderSchema.parse(this.cfg.mapRecord(r)));
  }
}
