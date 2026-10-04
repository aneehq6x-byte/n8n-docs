import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Radar, SearchX } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { can } from "@tenderpilot/core";
import {
  parseOpportunityQuery,
  serializeOpportunityQuery,
  type OpportunityListQuery,
  type OpportunitySort,
} from "@tenderpilot/core/domain";
import { DeadlineCell, OpportunityStatusBadge } from "@/components/opportunities/badges";
import { OpportunityFilters } from "@/components/opportunities/filters";
import { RunScoutButton } from "@/components/opportunities/run-scout-button";
import { ScoreCell } from "@/components/opportunities/score";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { pick } from "@/lib/i18n-utils";
import { cn } from "@/lib/utils";
import { getServerCaller } from "@/trpc/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: AppLocale }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "opportunities" });
  return { title: t("title") };
}

function hrefFor(query: OpportunityListQuery, patch: Partial<OpportunityListQuery>): string {
  const qs = serializeOpportunityQuery({ ...query, ...patch }).toString();
  return qs ? `/opportunities?${qs}` : "/opportunities";
}

async function SortHeader({
  query,
  column,
  label,
  className,
}: {
  query: OpportunityListQuery;
  column: OpportunitySort;
  label: string;
  className?: string;
}) {
  const t = await getTranslations("opportunities");
  const active = query.sort === column;
  // First click sorts the "natural" way: best score / soonest deadline / biggest value / newest.
  const firstDir = column === "deadline" ? "asc" : "desc";
  const dir = active ? (query.dir === "asc" ? "desc" : "asc") : firstDir;
  const Icon = !active ? ArrowUpDown : query.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-3 py-2.5 text-start font-medium", className)}
    >
      <Link
        href={hrefFor(query, { sort: column, dir, page: 1 })}
        scroll={false}
        className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}
        aria-label={t("sortBy", { column: label })}
      >
        {label}
        <Icon className={cn("size-3.5", !active && "opacity-40")} />
      </Link>
    </th>
  );
}

export default async function OpportunitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: AppLocale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = parseOpportunityQuery(await searchParams);
  const [t, tEnums, format, caller] = await Promise.all([
    getTranslations("opportunities"),
    getTranslations("enums"),
    getFormatter(),
    getServerCaller(),
  ]);
  const [me, result] = await Promise.all([caller.me(), caller.opportunities.list(query)]);
  const now = new Date();
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const filtered = serializeOpportunityQuery({ ...query, sort: undefined, dir: undefined, page: undefined }).toString() !== "";
  const canRunScout = can(me.role, "scout:run");

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canRunScout && <RunScoutButton variant="outline" />}
      </header>

      <Suspense>
        <OpportunityFilters />
      </Suspense>

      {result.total === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title={t("emptyFilteredTitle")}
            description={t("emptyFilteredDescription")}
            action={
              <Link href="/opportunities" className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t("filters.reset")}
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={Radar}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
            action={canRunScout ? <RunScoutButton /> : undefined}
          />
        )
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t("results", { total: result.total })}
          </p>

          {/* Mobile: stacked cards. */}
          <ul className="flex flex-col gap-3 md:hidden">
            {result.items.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/opportunities/${o.id}`}
                  className="flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium leading-snug">{pick(locale, o.tender.titleAr, o.tender.titleEn)}</span>
                    <ScoreCell score={o.score} disqualified={o.disqualified} />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {pick(locale, o.entity.nameAr, o.entity.nameEn)} · {tEnums(`sector.${o.tender.sector}`)}
                  </span>
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <DeadlineCell deadline={o.tender.submissionDeadline} now={now} />
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-sm font-medium">
                        {o.tender.valueEstimate === null ? t("noValue") : format.number(o.tender.valueEstimate, "sar")}
                      </span>
                      <OpportunityStatusBadge status={o.status} />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop: dense table. */}
          <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <SortHeader query={query} column="score" label={t("columns.score")} className="w-24" />
                  <th scope="col" className="px-3 py-2.5 text-start font-medium">
                    {t("columns.tender")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start font-medium">
                    {t("columns.sector")}
                  </th>
                  <SortHeader query={query} column="value" label={t("columns.value")} />
                  <SortHeader query={query} column="deadline" label={t("columns.deadline")} />
                  <SortHeader query={query} column="published" label={t("columns.published")} />
                  <th scope="col" className="px-3 py-2.5 text-start font-medium">
                    {t("columns.status")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.items.map((o) => (
                  <tr key={o.id} className={cn("group relative align-top transition-colors hover:bg-accent/40", o.disqualified && "bg-muted/20")}>
                    <td className="px-3 py-3">
                      <ScoreCell score={o.score} disqualified={o.disqualified} />
                    </td>
                    <td className="max-w-md px-3 py-3">
                      <Link
                        href={`/opportunities/${o.id}`}
                        className="font-medium leading-snug after:absolute after:inset-0 group-hover:text-primary"
                      >
                        {pick(locale, o.tender.titleAr, o.tender.titleEn)}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                        <span>{pick(locale, o.entity.nameAr, o.entity.nameEn)}</span>
                        <span className="ltr-nums">#{o.tender.sourceRef}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{tEnums(`sector.${o.tender.sector}`)}</td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                      {o.tender.valueEstimate === null ? (
                        <span className="text-muted-foreground">{t("noValue")}</span>
                      ) : (
                        format.number(o.tender.valueEstimate, "sar")
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <DeadlineCell deadline={o.tender.submissionDeadline} now={now} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-muted-foreground tabular-nums">
                      {format.dateTime(o.tender.publishedAt, "short")}
                    </td>
                    <td className="px-3 py-3">
                      <OpportunityStatusBadge status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <nav className="flex items-center justify-between gap-2" aria-label={t("pageOf", { page: query.page, pages })}>
              <span className="text-sm text-muted-foreground">{t("pageOf", { page: query.page, pages })}</span>
              <div className="flex gap-2">
                <Link
                  href={hrefFor(query, { page: query.page - 1 })}
                  aria-disabled={query.page <= 1}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), query.page <= 1 && "pointer-events-none opacity-50")}
                >
                  <ChevronLeft className="rtl:-scale-x-100" />
                  {t("previous")}
                </Link>
                <Link
                  href={hrefFor(query, { page: query.page + 1 })}
                  aria-disabled={query.page >= pages}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), query.page >= pages && "pointer-events-none opacity-50")}
                >
                  {t("next")}
                  <ChevronRight className="rtl:-scale-x-100" />
                </Link>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
