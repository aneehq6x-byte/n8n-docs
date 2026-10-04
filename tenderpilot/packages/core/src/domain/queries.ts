import { z } from "zod";
import { opportunityStatusSchema, sectorSchema } from "./enums";

export const OPPORTUNITY_SORTS = ["score", "deadline", "value", "published"] as const;
export type OpportunitySort = (typeof OPPORTUNITY_SORTS)[number];
export const DEADLINE_WINDOWS = ["any", "week", "month", "closed"] as const;
export const ELIGIBILITY_FILTERS = ["all", "eligible", "disqualified"] as const;
export const MIN_SCORE_OPTIONS = [50, 75] as const;

/**
 * Opportunity list query — shared by the tRPC procedure, the SQL builder and
 * the URL search-param codec, so the three can never drift apart.
 */
export const opportunityListInputSchema = z.object({
  q: z.string().trim().max(120).optional(),
  sector: sectorSchema.optional(),
  status: opportunityStatusSchema.optional(),
  eligibility: z.enum(ELIGIBILITY_FILTERS).default("all"),
  deadline: z.enum(DEADLINE_WINDOWS).default("any"),
  minScore: z.coerce.number().min(0).max(100).optional(),
  sort: z.enum(OPPORTUNITY_SORTS).default("score"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});
export type OpportunityListInput = z.input<typeof opportunityListInputSchema>;
export type OpportunityListQuery = z.output<typeof opportunityListInputSchema>;

const FIELDS = Object.keys(opportunityListInputSchema.shape) as (keyof typeof opportunityListInputSchema.shape)[];

/**
 * Lenient URL → query decoding: each param is validated on its own and invalid
 * ones are dropped (a hand-edited URL never breaks the page).
 */
export function parseOpportunityQuery(params: Record<string, string | string[] | undefined>): OpportunityListQuery {
  const candidate: Record<string, string> = {};
  for (const key of FIELDS) {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined || value === "") continue;
    if (opportunityListInputSchema.shape[key].safeParse(value).success) candidate[key] = value;
  }
  return opportunityListInputSchema.parse(candidate);
}

const DEFAULTS = opportunityListInputSchema.parse({});

/** Query → URL params, omitting defaults so links stay short and shareable. */
export function serializeOpportunityQuery(query: Partial<OpportunityListQuery>): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of FIELDS) {
    const value = query[key];
    if (value === undefined || value === "" || value === DEFAULTS[key]) continue;
    params.set(key, String(value));
  }
  return params;
}
