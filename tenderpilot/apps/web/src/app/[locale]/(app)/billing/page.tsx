import { Building, CreditCard, Info, Lock } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { PlanPicker } from "@/components/billing/plan-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Badge } from "@/components/ui/misc";
import type { AppLocale } from "@/i18n/routing";
import { getServerCaller } from "@/trpc/server";

export async function generateMetadata({ params }: { params: Promise<{ locale: AppLocale }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "billing" });
  return { title: t("title") };
}

const STATUS_VARIANT = { pending: "warning", paid: "success", failed: "destructive", expired: "secondary" } as const;

export default async function BillingPage({ params }: { params: Promise<{ locale: AppLocale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, format, caller] = await Promise.all([getTranslations("billing"), getFormatter(), getServerCaller()]);
  const o = await caller.billing.overview();
  const e = o.entitlements;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary">
              <CreditCard className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">{t("current")}</span>
              <span className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                {t(`plans.${e.plan}`)}
                <Badge variant={e.active ? (e.warn ? "warning" : "success") : "destructive"}>{e.active ? t(`status.${e.status}`) : t("inactive")}</Badge>
              </span>
              <span className="text-xs text-muted-foreground">
                {t("periodEnds", { days: e.daysLeft, date: format.dateTime(e.periodEnd, "short") })}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1 text-sm text-muted-foreground sm:items-end">
            <span>{t("seatsLimit", { seats: e.seats })}</span>
            <span>{t("runsLimit", { runs: e.scoutRunsPerDay })}</span>
          </div>
        </CardContent>
      </Card>

      {!o.canManage && (
        <Alert>
          <Lock />
          {t("readOnly")}
        </Alert>
      )}
      {o.canManage && !o.checkoutEnabled && (
        <Alert variant="warning">
          <Info />
          {t("checkoutDisabled")}
        </Alert>
      )}

      <PlanPicker
        plans={o.plans}
        currentPlan={e.plan}
        currentActive={e.active && e.status === "active"}
        canManage={o.canManage}
        checkoutEnabled={o.checkoutEnabled}
      />

      <Alert>
        <Building />
        {t("enterprise")}
      </Alert>

      {o.canManage && (
        <Card>
          <CardHeader>
            <CardTitle>{t("historyTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {o.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>
            ) : (
              <ul className="flex flex-col divide-y text-sm">
                {o.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="min-w-28 tabular-nums text-muted-foreground">{format.dateTime(h.createdAt, "short")}</span>
                    <span className="flex-1 font-medium">
                      {t(`plans.${h.plan}`)} · {t(h.interval)}
                    </span>
                    <span className="tabular-nums">{format.number(h.totalHalalas / 100, "sarExact")}</span>
                    <Badge variant={STATUS_VARIANT[h.status]}>{t(`checkoutStatus.${h.status}`)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
