import { and, asc, avg, count, desc, eq, gt, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import {
  ACTIVE_OPPORTUNITY_STATUSES,
  opportunityListInputSchema,
  opportunityStatusSchema,
  sectorSchema,
  type Entity,
  type Opportunity,
  type OpportunityListInput,
  type OpportunityListQuery,
  type OpportunityStatus,
  type Sector,
  type Tender,
  type TenderStatus,
} from "@tenderpilot/core";
import { latestAuditEvent, writeAudit } from "../audit";
import type { Database } from "../client";
import { toEntity, toOpportunity, toTender } from "../mappers";
import { entities, opportunities, tenders } from "../schema";

export interface OpportunityListItem {
  id: string;
  score: number;
  disqualified: boolean;
  status: OpportunityStatus;
  tender: {
    id: string;
    source: string;
    sourceRef: string;
    titleAr: string;
    titleEn: string;
    sector: Sector;
    valueEstimate: number | null;
    submissionDeadline: Date;
    publishedAt: Date;
    status: TenderStatus;
  };
  entity: { nameAr: string; nameEn: string };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function buildFilters(orgId: string, f: OpportunityListQuery, now: Date): SQL[] {
  // Tenant scoping is applied on the opportunities table itself — never optional.
  const where: SQL[] = [eq(opportunities.orgId, orgId)];
  if (f.q) {
    const term = `%${escapeLike(f.q)}%`;
    const match = or(
      ilike(tenders.titleAr, term),
      ilike(tenders.titleEn, term),
      ilike(tenders.sourceRef, term),
      ilike(entities.nameAr, term),
      ilike(entities.nameEn, term),
    );
    if (match) where.push(match);
  }
  if (f.sector) where.push(eq(tenders.sector, f.sector));
  if (f.status) where.push(eq(opportunities.status, f.status));
  if (f.eligibility === "eligible") where.push(eq(opportunities.disqualified, false));
  if (f.eligibility === "disqualified") where.push(eq(opportunities.disqualified, true));
  if (f.minScore !== undefined) where.push(gte(opportunities.score, f.minScore));
  if (f.deadline === "week") where.push(gt(tenders.submissionDeadline, now), lte(tenders.submissionDeadline, new Date(now.getTime() + 7 * DAY_MS)));
  if (f.deadline === "month") where.push(gt(tenders.submissionDeadline, now), lte(tenders.submissionDeadline, new Date(now.getTime() + 30 * DAY_MS)));
  if (f.deadline === "closed") where.push(lte(tenders.submissionDeadline, now));
  return where;
}

const SORT_COLUMNS = {
  score: opportunities.score,
  deadline: tenders.submissionDeadline,
  value: tenders.valueEstimate,
  published: tenders.publishedAt,
} as const;

export async function listOpportunities(
  db: Database,
  orgId: string,
  input: OpportunityListInput,
  now: Date = new Date(),
): Promise<{ items: OpportunityListItem[]; total: number; page: number; pageSize: number }> {
  const f = opportunityListInputSchema.parse(input);
  const where = and(...buildFilters(orgId, f, now));
  const column = SORT_COLUMNS[f.sort];
  const primary = f.dir === "asc" ? sql`${column} asc nulls last` : sql`${column} desc nulls last`;

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: opportunities.id,
        score: opportunities.score,
        disqualified: opportunities.disqualified,
        status: opportunities.status,
        tender: {
          id: tenders.id,
          source: tenders.source,
          sourceRef: tenders.sourceRef,
          titleAr: tenders.titleAr,
          titleEn: tenders.titleEn,
          sector: tenders.sector,
          valueEstimate: tenders.valueEstimate,
          submissionDeadline: tenders.submissionDeadline,
          publishedAt: tenders.publishedAt,
          status: tenders.status,
        },
        entity: { nameAr: entities.nameAr, nameEn: entities.nameEn },
      })
      .from(opportunities)
      .innerJoin(tenders, eq(tenders.id, opportunities.tenderId))
      .innerJoin(entities, eq(entities.id, tenders.entityId))
      .where(where)
      // Stable tie-breakers keep pagination deterministic.
      .orderBy(primary, asc(tenders.submissionDeadline), asc(opportunities.id))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ value: count() })
      .from(opportunities)
      .innerJoin(tenders, eq(tenders.id, opportunities.tenderId))
      .innerJoin(entities, eq(entities.id, tenders.entityId))
      .where(where),
  ]);

  const items = rows.map((r) => ({
    ...r,
    status: opportunityStatusSchema.parse(r.status),
    tender: { ...r.tender, sector: sectorSchema.parse(r.tender.sector) },
  }));
  return { items, total: totalRow?.value ?? 0, page: f.page, pageSize: f.pageSize };
}

export interface OpportunityDetail {
  opportunity: Opportunity;
  disqualified: boolean;
  scoredAt: Date;
  tender: Tender;
  entity: Entity;
}

export async function getOpportunityDetail(db: Database, orgId: string, id: string): Promise<OpportunityDetail | null> {
  const [row] = await db
    .select({ opportunity: opportunities, tender: tenders, entity: entities })
    .from(opportunities)
    .innerJoin(tenders, eq(tenders.id, opportunities.tenderId))
    .innerJoin(entities, eq(entities.id, tenders.entityId))
    .where(and(eq(opportunities.orgId, orgId), eq(opportunities.id, id)))
    .limit(1);
  if (!row) return null;
  return {
    opportunity: toOpportunity(row.opportunity),
    disqualified: row.opportunity.disqualified,
    scoredAt: row.opportunity.scoredAt,
    tender: toTender(row.tender),
    entity: toEntity(row.entity),
  };
}

export async function updateOpportunityStatus(
  db: Database,
  orgId: string,
  id: string,
  status: OpportunityStatus,
  actorUserId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ status: opportunities.status })
      .from(opportunities)
      .where(and(eq(opportunities.orgId, orgId), eq(opportunities.id, id)))
      .limit(1);
    if (!before) return false;
    await tx
      .update(opportunities)
      .set({ status })
      .where(and(eq(opportunities.orgId, orgId), eq(opportunities.id, id)));
    await writeAudit(tx, {
      orgId,
      actorUserId,
      action: "opportunity.status_changed",
      targetType: "opportunity",
      targetId: id,
      metadata: { from: before.status, to: status },
    });
    return true;
  });
}

export interface DashboardSummary {
  openOpportunities: number;
  averageScore: number | null;
  deadlinesThisWeek: number;
  disqualified: number;
  tendersTracked: number;
  topSectors: { sector: Sector; count: number; averageScore: number }[];
  recentHighScore: OpportunityListItem[];
  lastScoutAt: Date | null;
}

/** KPIs for the dashboard. "Open" = eligible, still in an active status, deadline in the future. */
export async function getDashboardSummary(db: Database, orgId: string, now: Date = new Date()): Promise<DashboardSummary> {
  const open = and(
    eq(opportunities.orgId, orgId),
    eq(opportunities.disqualified, false),
    inArray(opportunities.status, [...ACTIVE_OPPORTUNITY_STATUSES]),
    gt(tenders.submissionDeadline, now),
  );
  const weekEnd = new Date(now.getTime() + 7 * DAY_MS);

  const [[kpis], [week], [dq], tracked, sectors, high, lastScout] = await Promise.all([
    db
      .select({ open: count(), avgScore: avg(opportunities.score) })
      .from(opportunities)
      .innerJoin(tenders, eq(tenders.id, opportunities.tenderId))
      .where(open),
    db
      .select({ value: count() })
      .from(opportunities)
      .innerJoin(tenders, eq(tenders.id, opportunities.tenderId))
      .where(and(open, lte(tenders.submissionDeadline, weekEnd))),
    db
      .select({ value: count() })
      .from(opportunities)
      .where(and(eq(opportunities.orgId, orgId), eq(opportunities.disqualified, true))),
    db.$count(tenders, eq(tenders.orgId, orgId)),
    db
      .select({ sector: tenders.sector, count: count(), averageScore: avg(opportunities.score) })
      .from(opportunities)
      .innerJoin(tenders, eq(tenders.id, opportunities.tenderId))
      .where(open)
      .groupBy(tenders.sector)
      .orderBy(desc(count()), desc(avg(opportunities.score)))
      .limit(4),
    listOpportunities(db, orgId, { eligibility: "eligible", minScore: 70, sort: "score", dir: "desc", pageSize: 5 }, now),
    latestAuditEvent(db, orgId, "scout.completed"),
  ]);

  return {
    openOpportunities: kpis?.open ?? 0,
    averageScore: kpis?.avgScore === null || kpis?.avgScore === undefined ? null : Number(kpis.avgScore),
    deadlinesThisWeek: week?.value ?? 0,
    disqualified: dq?.value ?? 0,
    tendersTracked: tracked,
    topSectors: sectors.map((s) => ({
      sector: sectorSchema.parse(s.sector),
      count: s.count,
      averageScore: Number(s.averageScore ?? 0),
    })),
    recentHighScore: high.items.filter((i) => i.tender.submissionDeadline > now && i.status !== "dismissed"),
    lastScoutAt: lastScout?.createdAt ?? null,
  };
}
