import { TRPCError } from "@trpc/server";
import { AlertTriangle, ArrowLeft, FileText } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";
import { can } from "@tenderpilot/core";
import { DeadlineCell } from "@/components/opportunities/badges";
import { FactorBreakdown } from "@/components/opportunities/factor-breakdown";
import { ScoreRing } from "@/components/opportunities/score";
import { StatusSelect } from "@/components/opportunities/status-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Badge } from "@/components/ui/misc";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { localized } from "@/lib/i18n-utils";
import { getServerCaller } from "@/trpc/server";

async function loadDetail(id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const caller = await getServerCaller();
  try {
    return await caller.opportunities.get({ id });
  } catch (err) {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") return null;
    throw err;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ locale: AppLocale; id: string }> }) {
  const { locale, id } = await params;
  const detail = await loadDetail(id);
  return { title: detail ? localized(locale, detail.tender.title) : undefined };
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

export default async function OpportunityDetailPage({ params }: { params: Promise<{ locale: AppLocale; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const detail = await loadDetail(id);
  if (!detail) notFound();

  const [t, tEnums, format, caller] = await Promise.all([
    getTranslations("opportunity"),
    getTranslations("enums"),
    getFormatter(),
    getServerCaller(),
  ]);
  const me = await caller.me();
  const { opportunity, tender, entity, scoredAt } = detail;
  const breakdown = opportunity.scoreBreakdown;
  const now = new Date();
  const value = tender.valueEstimate;
  const bond = (pct: number) =>
    value === null
      ? t("bondPct", { pct: format.number(pct * 100, "plain") })
      : t("bondValue", { pct: format.number(pct * 100, "plain"), amount: format.number(value * pct, "sar") });

  return (
    <div className="flex flex-col gap-6">
      <Link href="/opportunities" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {t("back")}
      </Link>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{tEnums(`sector.${tender.sector}`)}</Badge>
          <Badge variant={tender.status === "closing_soon" ? "warning" : tender.status === "open" ? "success" : "secondary"}>
            {tEnums(`tenderStatus.${tender.status}`)}
          </Badge>
          <span className="ltr-nums text-xs text-muted-foreground">
            {tender.source} #{tender.sourceRef}
          </span>
        </div>
        <h1 className="text-2xl font-semibold leading-tight text-balance">{localized(locale, tender.title)}</h1>
        <p className="text-sm text-muted-foreground">{localized(locale, entity.name)}</p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
              <ScoreRing score={opportunity.score} disqualified={breakdown.disqualified} />
              <StatusSelect id={opportunity.id} status={opportunity.status} canUpdate={can(me.role, "opportunity:update")} />
            </CardContent>
            {breakdown.disqualified && (
              <CardContent>
                <Alert variant="destructive">
                  <AlertTriangle />
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">
                      {locale === "ar" ? breakdown.disqualificationReasonAr : breakdown.disqualificationReasonEn}
                    </span>
                    <span className="text-xs opacity-90">{t("disqualifiedHint")}</span>
                  </div>
                </Alert>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("breakdownTitle")}</CardTitle>
              <CardDescription>
                {t("breakdownSubtitle")} · {t("scoredAt", { time: format.relativeTime(scoredAt, now) })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FactorBreakdown factors={breakdown.factors} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("description")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">{localized(locale, tender.description)}</p>
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t("details")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-4">
              <Fact label={t("issuer")}>
                {localized(locale, entity.name)}
                {entity.region && <span className="block text-xs font-normal text-muted-foreground">{localized(locale, entity.region)}</span>}
              </Fact>
              <Fact label={t("value")}>{value === null ? "—" : format.number(value, "sar")}</Fact>
              <Fact label={t("deadline")}>
                <DeadlineCell deadline={tender.submissionDeadline} now={now} />
              </Fact>
              <Fact label={t("published")}>{format.dateTime(tender.publishedAt, "short")}</Fact>
              <Fact label={t("bidBond")}>{bond(tender.guarantee.bidBondPct)}</Fact>
              <Fact label={t("performanceBond")}>{bond(tender.guarantee.performanceBondPct)}</Fact>
              <Fact label={t("classification")}>
                {tender.requiredClassificationField && tender.requiredClassificationGrade
                  ? t("classificationValue", {
                      field: tEnums(`classificationField.${tender.requiredClassificationField}`),
                      grade: tender.requiredClassificationGrade,
                    })
                  : t("noClassification")}
              </Fact>
              <Fact label={t("certifications")}>
                {tender.requiredCertifications.length === 0 ? (
                  t("noCertifications")
                ) : (
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {tender.requiredCertifications.map((c) => (
                      <Badge key={c} variant="outline" className="font-normal">
                        {tEnums(`certification.${c}`)}
                      </Badge>
                    ))}
                  </span>
                )}
              </Fact>
              {tender.rawDocumentRefs.length > 0 && (
                <Fact label={t("documents")}>
                  <ul className="flex flex-col gap-1">
                    {tender.rawDocumentRefs.map((ref) => (
                      <li key={ref} className="ltr-nums flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                        <FileText className="size-3.5 shrink-0" />
                        <span className="truncate">{ref.split("/").pop()}</span>
                      </li>
                    ))}
                  </ul>
                </Fact>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
