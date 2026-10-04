import { ArrowRight, CalendarClock, Gauge, Layers, Radar, Target } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { can } from "@tenderpilot/core";
import { DeadlineCell } from "@/components/opportunities/badges";
import { RunScoutButton } from "@/components/opportunities/run-scout-button";
import { ScoreCell } from "@/components/opportunities/score";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { pick } from "@/lib/i18n-utils";
import { getServerCaller } from "@/trpc/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: AppLocale }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "dashboard" });
  return { title: t("title") };
}

function StatTile({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-5">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="size-4" />
          {label}
        </span>
        {/* Proportional figures for standalone values. */}
        <span className="text-3xl font-semibold tracking-tight">{value}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage({ params }: { params: Promise<{ locale: AppLocale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, tEnums, format, caller] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("enums"),
    getFormatter(),
    getServerCaller(),
  ]);
  const [me, summary] = await Promise.all([caller.me(), caller.dashboard.summary()]);
  const canRunScout = can(me.role, "scout:run");
  const now = new Date();
  const maxSectorCount = Math.max(1, ...summary.topSectors.map((s) => s.count));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{t("welcome", { name: me.user.name })}</h1>
          <p className="text-sm text-muted-foreground">
            {t("subtitle")}{" "}
            <span className="whitespace-nowrap">
              ·{" "}
              {summary.lastScoutAt
                ? t("lastSynced", { time: format.relativeTime(summary.lastScoutAt, now) })
                : t("neverSynced")}
            </span>
          </p>
        </div>
        {canRunScout && <RunScoutButton />}
      </header>

      {summary.tendersTracked === 0 ? (
        <EmptyState
          icon={Radar}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={canRunScout ? <RunScoutButton /> : undefined}
        />
      ) : (
        <>
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("title")}>
            <StatTile
              icon={Target}
              label={t("kpi.open")}
              value={format.number(summary.openOpportunities, "plain")}
              hint={t("kpi.openHint")}
            />
            <StatTile
              icon={Gauge}
              label={t("kpi.avgScore")}
              value={summary.averageScore === null ? "—" : format.number(summary.averageScore, "plain")}
              hint={t("kpi.avgScoreHint")}
            />
            <StatTile
              icon={CalendarClock}
              label={t("kpi.deadlinesWeek")}
              value={format.number(summary.deadlinesThisWeek, "plain")}
              hint={t("kpi.deadlinesWeekHint")}
            />
            <StatTile
              icon={Layers}
              label={t("kpi.tracked")}
              value={format.number(summary.tendersTracked, "plain")}
              hint={t("kpi.trackedHint", { count: summary.disqualified })}
            />
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="flex flex-col gap-1.5">
                  <CardTitle>{t("highScoreTitle")}</CardTitle>
                  <CardDescription>{t("highScoreSubtitle")}</CardDescription>
                </div>
                <Link
                  href={{ pathname: "/opportunities", query: { eligibility: "eligible", minScore: "75" } }}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  {t("viewAll")}
                  <ArrowRight className="rtl:-scale-x-100" />
                </Link>
              </CardHeader>
              <CardContent>
                {summary.recentHighScore.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">{t("highScoreEmpty")}</p>
                ) : (
                  <ul className="flex flex-col divide-y">
                    {summary.recentHighScore.map((o) => (
                      <li key={o.id}>
                        <Link
                          href={`/opportunities/${o.id}`}
                          className="-mx-2 flex items-center gap-4 rounded-md px-2 py-3 transition-colors hover:bg-accent/60"
                        >
                          <ScoreCell score={o.score} disqualified={o.disqualified} />
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate font-medium">{pick(locale, o.tender.titleAr, o.tender.titleEn)}</span>
                            <span className="truncate text-xs text-muted-foreground">
                              {pick(locale, o.entity.nameAr, o.entity.nameEn)} · {tEnums(`sector.${o.tender.sector}`)}
                              {o.tender.valueEstimate !== null && ` · ${format.number(o.tender.valueEstimate, "sar")}`}
                            </span>
                          </div>
                          <div className="hidden sm:block">
                            <DeadlineCell deadline={o.tender.submissionDeadline} now={now} />
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("sectorsTitle")}</CardTitle>
                <CardDescription>{t("sectorsSubtitle")}</CardDescription>
              </CardHeader>
              <CardContent>
                {summary.topSectors.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">{t("sectorsEmpty")}</p>
                ) : (
                  <ul className="flex flex-col gap-4">
                    {summary.topSectors.map((s) => (
                      <li key={s.sector} className="flex flex-col gap-1.5">
                        <Link
                          href={{ pathname: "/opportunities", query: { sector: s.sector, eligibility: "eligible" } }}
                          className="flex items-baseline justify-between gap-2 text-sm hover:underline"
                        >
                          <span className="font-medium">{tEnums(`sector.${s.sector}`)}</span>
                          <span className="text-xs text-muted-foreground">
                            {t("sectorCount", { count: s.count })} · {t("avgShort", { score: format.number(s.averageScore, "plain") })}
                          </span>
                        </Link>
                        {/* One series → one hue; track is a lighter step of the same hue. */}
                        <div
                          className="h-2 overflow-hidden rounded-full bg-primary/15"
                          title={`${tEnums(`sector.${s.sector}`)}: ${s.count}`}
                        >
                          <div className="h-full rounded-full bg-primary" style={{ width: `${(s.count / maxSectorCount) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
