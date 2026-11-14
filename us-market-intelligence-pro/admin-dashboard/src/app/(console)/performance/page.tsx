import { FlaskConical, History, Radio, TrendingUp } from "lucide-react";
import { DivergingBars, LineChart } from "@/components/charts";
import { Card, CardBody, CardHeader, EmptyState, Notice, PageHeader, StatTile, Table, Tabs, Td, Th, Tr, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate, fmtNumber, fmtPct, fmtR } from "@/lib/format";
import { requireRole } from "@/lib/guard";
import { getI18n } from "@/lib/prefs";
import type { Performance, ResultKind, Summary } from "@/lib/types";

export const metadata = { title: "Performance" };
const KINDS: ResultKind[] = ["published", "paper", "backtest"];
const BANNER: Record<ResultKind, { tone: Tone; icon: typeof Radio }> = {
  published: { tone: "accent", icon: Radio },
  paper: { tone: "warning", icon: FlaskConical },
  backtest: { tone: "serious", icon: History },
};

export default async function PerformancePage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  await requireRole("analyst");
  const [{ locale, d }, sp] = await Promise.all([getI18n(), searchParams]);
  const kind = (KINDS as string[]).includes(sp.kind ?? "") ? (sp.kind as ResultKind) : "published";
  const p = await api<Performance>(`/admin/performance?kind=${kind}`);
  const o = p.overall;
  const B = BANNER[kind];
  const r = (n: number | null) => fmtR(n, locale);
  const chartLabels = { x: d.chart.date, y: d.performance.totalR, caption: d.chart.tableCaption, toggle: d.common.viewTable };
  const shortDate = (iso: string) => fmtDate(iso, locale).replace(/,? \d{4}$/, "");

  const breakdown = (title: string, data: Record<string, Summary>, labelOf: (k: string) => string = (k) => k) => {
    const rows = Object.entries(data).sort((a, b) => (b[1].expectancy_r ?? 0) - (a[1].expectancy_r ?? 0));
    return (
      <Card>
        <CardHeader title={title} subtitle={d.performance.expectancy} />
        <CardBody>
          {rows.length ? (
            <DivergingBars kind="r" locale={locale}
              rows={rows.map(([k, s]) => ({ label: labelOf(k), value: s.expectancy_r ?? 0, sub: `n=${s.trades}` }))} />
          ) : <p className="text-sm text-muted">{d.common.empty}</p>}
        </CardBody>
        {rows.length ? (
          <details className="border-t border-line px-5 py-3 text-xs">
            <summary className="cursor-pointer text-muted hover:text-ink">{d.common.viewTable}</summary>
            <div className="mt-2 overflow-x-auto">
              <Table>
                <thead><tr><Th>{title}</Th><Th className="text-end">{d.performance.trades}</Th><Th className="text-end">{d.performance.winRate}</Th><Th className="text-end">{d.performance.profitFactor}</Th><Th className="text-end">{d.performance.totalR}</Th></tr></thead>
                <tbody>
                  {rows.map(([k, s]) => (
                    <Tr key={k}>
                      <Td>{labelOf(k)}</Td><Td className="text-end tnum">{s.trades}</Td><Td className="text-end tnum">{fmtPct(s.win_rate, locale)}</Td>
                      <Td className="text-end tnum">{fmtNumber(s.profit_factor, locale, { maximumFractionDigits: 2 })}</Td><Td className="text-end tnum">{r(s.total_r)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </details>
        ) : null}
      </Card>
    );
  };

  return (
    <>
      <PageHeader title={d.performance.title} subtitle={d.performance.subtitle} />
      <Tabs active={kind} items={KINDS.map((k) => ({ key: k, label: d.signals.kinds[k], href: `/performance?kind=${k}` }))} />
      <Notice tone={B.tone} icon={<B.icon className="size-4" />} className="mb-6">
        <strong className="font-semibold">{d.signals.kinds[kind]}</strong> — {d.performance.banner[kind]}
      </Notice>

      {o.trades === 0 ? (
        <Card><EmptyState icon={<TrendingUp className="size-8" strokeWidth={1.5} />} title={d.performance.noTrades}>{d.performance.methodology}</EmptyState></Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatTile label={d.performance.expectancy} value={r(o.expectancy_r)} hint={`${d.performance.trades}: ${o.trades}`} />
            <StatTile label={d.performance.winRate} value={fmtPct(o.win_rate, locale)} hint={`${d.performance.avgWin} ${r(o.avg_win_r)} · ${d.performance.avgLoss} ${r(o.avg_loss_r)}`} />
            <StatTile label={d.performance.profitFactor} value={fmtNumber(o.profit_factor, locale, { maximumFractionDigits: 2 })} />
            <StatTile label={d.performance.maxDd} value={r(-o.max_drawdown_r)} hint={`${d.performance.totalR}: ${r(o.total_r)}`} />
          </div>
          <Card className="mb-6">
            <CardHeader title={d.performance.equity} subtitle={d.performance.methodology} />
            <CardBody>
              <LineChart zeroLine area={false} kind="r" locale={locale} labels={chartLabels} ariaLabel={d.performance.equity}
                points={p.equity_curve.map((e) => ({ x: e.ref, y: e.cum_r, label: `${fmtDate(e.at, locale)} · ${e.ref}`, tick: shortDate(e.at) }))} />
            </CardBody>
          </Card>
          <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
            {breakdown(d.performance.byStrategy, p.by_strategy)}
            {breakdown(d.performance.bySymbol, p.by_symbol)}
            {breakdown(d.performance.bySession, p.by_session, (k) => d.performance.session[k as keyof typeof d.performance.session] ?? k)}
          </div>
        </>
      )}
      <Card>
        <CardHeader title={d.performance.statusCounts} subtitle={`${d.performance.expiredNote}: ${fmtNumber(p.expired_not_counted, locale)}`} />
        <CardBody className="flex flex-wrap gap-2">
          {Object.entries(p.status_counts).map(([k, v]) => (
            <span key={k} className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs text-ink-2">
              {d.signals.status[k as keyof typeof d.signals.status] ?? k}: <strong className="text-ink tnum">{v}</strong>
            </span>
          ))}
        </CardBody>
      </Card>
    </>
  );
}
