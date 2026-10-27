import { AlertOctagon, AlertTriangle, ArrowLeft, ArrowRight, Info, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { ColumnChart, LineChart } from "@/components/charts";
import { SignalStatusBadge } from "@/components/status";
import { Card, CardBody, CardHeader, Notice, PageHeader, StatTile, Badge, LinkButton, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtNumber, fmtPct } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getI18n } from "@/lib/prefs";
import type { Overview, SignalStatus } from "@/lib/types";

const PIPELINE: SignalStatus[] = ["validated", "approved", "published", "active", "target1_hit", "target2_hit", "stopped", "expired", "cancelled", "rejected"];

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ forbidden?: string }> }) {
  const [{ locale, d }, sp, o] = await Promise.all([getI18n(), searchParams, api<Overview>("/admin/overview")]);
  const b = o.business;
  const stars = (n: number) => `${fmtNumber(n, locale)} ⭐`;
  const label = (iso: string) => fmtDate(iso, locale, "UTC").replace(/,? \d{4}$/, "");
  const revenuePoints = b.series.map((p) => ({ x: p.date, y: p.revenue, label: label(p.date) }));
  const activePoints = b.series.map((p) => ({ x: p.date, y: p.active_subscribers, label: label(p.date) }));
  const chartLabels = { x: d.chart.date, y: d.chart.value, caption: d.chart.tableCaption, toggle: d.common.viewTable };
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight;

  const alertIcon = { critical: AlertOctagon, warning: AlertTriangle, info: Info } as const;
  const alertTone: Record<string, Tone> = { critical: "critical", warning: "warning", info: "accent" };

  return (
    <>
      <PageHeader
        title={d.overview.title}
        subtitle={<>{t(d.overview.subtitle, { days: b.window_days })} · {d.common.dataAsOf} {fmtDateTime(o.generated_at, locale)} ({d.common.riyadh})</>}
        actions={<Badge tone={o.publish_mode === "human_approval" ? "good" : "warning"}>{d.overview.publishMode}: {o.publish_mode === "human_approval" ? d.system.human : d.system.automatic}</Badge>}
      />

      {sp.forbidden ? <Notice tone="critical" icon={<ShieldAlert className="size-4" />} className="mb-4">{d.common.forbidden}</Notice> : null}

      {o.alerts.length ? (
        <div className="mb-6 flex flex-col gap-2">
          {o.alerts.map((a, i) => {
            const Icon = alertIcon[a.level];
            const text =
              a.code === "dead_letters" || a.code === "pending_review"
                ? `${fmtNumber(a.count ?? 0, locale)} ${d.alerts[a.code]}`
                : a.code === "safety" ? `${d.alerts.safety}: ${a.detail}` : d.alerts[a.code];
            const href = a.code === "pending_review" ? "/signals?tab=queue" : a.code === "dead_letters" || a.code === "kill_switch" ? "/system" : undefined;
            return (
              <Notice key={i} tone={alertTone[a.level]} icon={<Icon className="size-4" />}>
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span>{text}</span>
                  {href ? <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium underline-offset-4 hover:underline">{d.overview.reviewNow}<Arrow className="size-3" /></Link> : null}
                </span>
              </Notice>
            );
          })}
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-line bg-surface p-5 shadow-card sm:col-span-2 xl:col-span-1 xl:row-span-2">
          <p className="text-xs font-medium text-ink-2">{d.overview.activeSubs}</p>
          <p className="mt-3 text-5xl font-semibold tracking-tight text-ink">{fmtNumber(b.active_subscribers, locale)}</p>
          <p className="mt-2 text-xs text-muted">{d.overview.totalUsers}: <span className="tnum">{fmtNumber(b.total_users, locale)}</span></p>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 text-xs">
            <div><p className="text-muted">{d.overview.expiring}</p><p className="mt-1 text-base font-semibold text-ink tnum">{fmtNumber(o.expiring_3d, locale)}</p></div>
            <div><p className="text-muted">{d.overview.newPaying}</p><p className="mt-1 text-base font-semibold text-ink tnum">{fmtNumber(b.new_paying_users_window, locale)}</p></div>
          </div>
        </div>
        <StatTile label={d.overview.revenue} value={stars(b.revenue_window)}
          hint={b.refunds_window ? <>{d.overview.refunds}: {stars(b.refunds_window)}</> : null} />
        <StatTile label={d.overview.mrr} value={stars(b.mrr_recurring_only)} hint={d.overview.mrrHint} />
        <StatTile label={d.overview.arpu} value={b.arpu_all_time === null ? "—" : stars(b.arpu_all_time)} />
        <StatTile label={d.overview.conversion} value={fmtPct(b.conversion_rate, locale)} />
        <StatTile label={d.overview.churn} value={fmtPct(b.churn_rate_window, locale)}
          hint={<span className="tnum">{fmtNumber(b.churned_users_window, locale)}</span>} />
        <StatTile label={d.overview.repeat} value={fmtPct(b.repeat_purchase_rate, locale)} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={d.overview.revenueByDay} subtitle={`${d.common.stars} · UTC`} />
          <CardBody>
            <ColumnChart points={revenuePoints} kind="stars" locale={locale} labels={chartLabels} ariaLabel={d.overview.revenueByDay} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={d.overview.activeOverTime} subtitle="UTC" />
          <CardBody>
            <LineChart points={activePoints} kind="count" locale={locale} labels={chartLabels} ariaLabel={d.overview.activeOverTime} />
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader title={d.overview.signalsPipeline} subtitle={d.overview.pipelineHint}
            actions={o.signals.pending_review ? <LinkButton size="sm" variant="primary" href="/signals?tab=queue">{d.overview.reviewNow}</LinkButton> : null} />
          <CardBody>
            <ul className="flex flex-col divide-y divide-line">
              {PIPELINE.map((s) => (
                <li key={s} className="flex items-center justify-between py-2 text-sm">
                  <SignalStatusBadge status={s} d={d} />
                  <span className="font-medium text-ink tnum">{fmtNumber(o.signals.by_status[s] ?? 0, locale)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title={d.overview.coupons} />
          {b.coupons.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <th className="px-5 py-2 text-start font-medium">{d.plans.code}</th>
                    <th className="px-5 py-2 text-start font-medium">{d.plans.percentOff}</th>
                    <th className="px-5 py-2 text-start font-medium">{d.plans.redemptions}</th>
                    <th className="px-5 py-2 text-end font-medium">{d.overview.revenue}</th>
                  </tr>
                </thead>
                <tbody>
                  {b.coupons.map((c) => (
                    <tr key={c.code} className="border-t border-line">
                      <td className="px-5 py-2.5 font-mono text-xs" dir="ltr">{c.code}</td>
                      <td className="px-5 py-2.5 tnum">{fmtNumber(c.percent_off / 100, locale, { style: "percent" })}</td>
                      <td className="px-5 py-2.5 tnum">{fmtNumber(c.redemptions, locale)}{c.max_redemptions ? ` / ${fmtNumber(c.max_redemptions, locale)}` : ""}</td>
                      <td className="px-5 py-2.5 text-end tnum">{stars(c.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <CardBody><p className="text-sm text-muted">{d.common.empty}</p></CardBody>}
          <details className="border-t border-line px-5 py-3 text-xs text-ink-2">
            <summary className="cursor-pointer text-muted hover:text-ink">{d.overview.definitions}</summary>
            <dl className="mt-2 flex flex-col gap-1.5" dir="ltr">
              {Object.entries(b.definitions).map(([k, v]) => (
                <div key={k}><dt className="inline font-mono">{k}</dt>: <dd className="inline">{v}</dd></div>
              ))}
            </dl>
          </details>
        </Card>
      </div>
    </>
  );
}
