import { rawTenderSchema, type RawTender } from "../domain/raw-tender";
import { etimadFixtures } from "../seed/fixtures";
import type { TenderConnector } from "./connector";

export interface MockEtimadOptions {
  /** Clock used to anchor the rolling fixture feed. Injected for deterministic tests. */
  clock?: () => Date;
  /** Override the feed entirely (e.g. duplicate-ref tests). */
  fixtures?: readonly RawTender[];
}

/**
 * Fixture-backed connector mimicking Etimad (اعتماد), the Saudi government's
 * unified e-tendering portal. The feed is anchored to the clock, so it behaves
 * like a live portal: tenders are always recently published with future deadlines.
 */
export class MockEtimadConnector implements TenderConnector {
  readonly source = "etimad";
  private readonly clock: () => Date;
  private readonly fixtures: readonly RawTender[] | undefined;

  constructor(opts: MockEtimadOptions = {}) {
    this.clock = opts.clock ?? (() => new Date());
    this.fixtures = opts.fixtures;
  }

  async fetchTenders(since: Date): Promise<RawTender[]> {
    const feed = this.fixtures ?? etimadFixtures(this.clock());
    return feed
      .map((t) => rawTenderSchema.parse(t)) // validate even our own fixtures
      .filter((t) => new Date(t.publishedAt) >= since);
  }
}
