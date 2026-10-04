import { describe, expect, it } from "vitest";
import { parseOpportunityQuery, serializeOpportunityQuery } from "../src";

describe("opportunity query codec", () => {
  it("applies defaults for an empty URL", () => {
    expect(parseOpportunityQuery({})).toMatchObject({ sort: "score", dir: "desc", page: 1, eligibility: "all" });
  });

  it("drops invalid params instead of failing the whole page", () => {
    const q = parseOpportunityQuery({ sector: "space_mining", page: "-3", minScore: "75", sort: "drop table" });
    expect(q.sector).toBeUndefined();
    expect(q.page).toBe(1);
    expect(q.sort).toBe("score");
    expect(q.minScore).toBe(75);
  });

  it("round-trips through the URL and omits defaults", () => {
    const q = parseOpportunityQuery({ q: "الرياض", sector: "construction", deadline: "week", page: "2" });
    const params = serializeOpportunityQuery(q);
    expect(params.get("sort")).toBeNull();
    expect(parseOpportunityQuery(Object.fromEntries(params))).toEqual(q);
  });
});
