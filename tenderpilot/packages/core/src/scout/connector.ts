import type { RawTender } from "../domain/raw-tender";

/**
 * Every tender source (Etimad, a ministry portal, a partner feed) implements
 * this one interface. Adding a source never touches the Scout pipeline.
 * Implementations MUST return Zod-validated `RawTender`s.
 */
export interface TenderConnector {
  /** Stable source key persisted on each tender (part of the dedupe key). */
  readonly source: string;
  /** Fetch tenders published or updated since the watermark. */
  fetchTenders(since: Date): Promise<RawTender[]>;
}
