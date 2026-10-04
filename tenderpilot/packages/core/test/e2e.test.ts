import { describe, expect, it } from "vitest";
import { buildDemoGraph, opportunitySchema, tenderSchema } from "../src";

const AS_OF = new Date("2026-06-26T00:00:00.000Z");

describe("Phase 1 pipeline (in-memory): scout → normalize → score", () => {
  it("ingests every tender and scores one explainable opportunity per tender", async () => {
    const graph = await buildDemoGraph(AS_OF);
    expect(graph.tenders.length).toBe(12);
    expect(graph.opportunities).toHaveLength(graph.tenders.length);
    for (const t of graph.tenders) expect(() => tenderSchema.parse(t)).not.toThrow();
    for (const o of graph.opportunities) {
      expect(() => opportunitySchema.parse(o)).not.toThrow();
      expect(o.scoreBreakdown.factors).toHaveLength(6);
    }
  });

  it("ranks eligible, well-matched tenders above disqualified ones", async () => {
    const graph = await buildDemoGraph(AS_OF);
    const byRef = (ref: string) => {
      const t = graph.tenders.find((x) => x.sourceRef === ref);
      return graph.opportunities.find((o) => o.tenderId === t?.id);
    };
    const best = byRef("250439001503");
    const mega = byRef("250551002388");
    expect(best?.scoreBreakdown.disqualified).toBe(false);
    expect(mega?.scoreBreakdown.disqualified).toBe(true);
    expect(best?.score ?? 0).toBeGreaterThan(mega?.score ?? 0);
  });

  it("produces a realistic spread: some disqualified, some strong matches", async () => {
    const { opportunities } = await buildDemoGraph(AS_OF);
    const disqualified = opportunities.filter((o) => o.scoreBreakdown.disqualified).length;
    const strong = opportunities.filter((o) => !o.scoreBreakdown.disqualified && o.score >= 75).length;
    expect(disqualified).toBeGreaterThanOrEqual(3);
    expect(strong).toBeGreaterThanOrEqual(3);
  });
});
