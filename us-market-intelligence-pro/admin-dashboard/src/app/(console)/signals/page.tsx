import { FlaskConical, Inbox, Plus } from "lucide-react";
import Link from "next/link";
import { DirectionTag, KindBadge, SignalStatusBadge } from "@/components/status";
import { Badge, Card, EmptyState, LinkButton, Notice, PageHeader, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDual, fmtNumber, relativeFromNow } from "@/lib/format";
import { requireRole } from "@/lib/guard";
import { getI18n } from "@/lib/prefs";
import type { Signal, SignalStatus, SystemInfo } from "@/lib/types";

export const metadata = { title: "Signals" };

const GROUPS: Record<string, SignalStatus[] | null> = {
  queue: ["validated"],
  open: ["approved", "published", "active", "target1_hit"],
  closed: ["target2_hit", "stopped", "expired", "cancelled", "rejected"],
  all: null,
};

export default async function SignalsPage({ searchParams }: { searchParams: Promise<{ tab?: string; created?: string }> }) {
  await requireRole("analyst");
  const [{ locale, d }, sp] = await Promise.all([getI18n(), searchParams]);
  const tab = sp.tab && sp.tab in GROUPS ? sp.tab : "queue";
  const [all, sys] = await Promise.all([api<Signal[]>("/admin/signals?limit=500"), api<SystemInfo>("/admin/system")]);
  const count = (k: string) => (GROUPS[k] ? all.filter((s) => GROUPS[k]!.includes(s.status)).length : all.length);
  const rows = GROUPS[tab] ? all.filter((s) => GROUPS[tab]!.includes(s.status)) : all;

  return (
    <>
      <PageHeader
        title={d.signals.title}
        subtitle={d.signals.subtitle}
        actions={<LinkButton variant="primary" href="/signals/new"><Plus className="size-4" />{d.signals.newManual}</LinkButton>}
      />
      {sp.created ? <Notice tone="good" className="mb-4">{d.signals.form.created}</Notice> : null}
      <Notice tone={sys.publish_mode === "human_approval" ? "accent" : "warning"} className="mb-4">
        {sys.publish_mode === "human_approval" ? d.signals.humanRequired : d.signals.autoMode}
        {sys.kill_switch ? <> · <strong>{d.alerts.kill_switch}</strong></> : null}
      </Notice>
      <Tabs
        active={tab}
        items={[
          { key: "queue", label: d.signals.queue, href: "/signals?tab=queue", count: count("queue") },
          { key: "open", label: d.signals.open, href: "/signals?tab=open", count: count("open") },
          { key: "closed", label: d.signals.closed, href: "/signals?tab=closed", count: count("closed") },
          { key: "all", label: d.signals.allSignals, href: "/signals?tab=all", count: count("all") },
        ]}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Inbox className="size-8" strokeWidth={1.5} />} title={tab === "queue" ? d.signals.noQueue : d.common.empty} />
        ) : (
          <Table caption={d.signals.title}>
            <thead>
              <tr>
                <Th>{d.signals.ref}</Th><Th>{d.signals.symbol}</Th><Th>{d.signals.strategy}</Th>
                <Th>{d.signals.kind}</Th><Th>{d.common.status}</Th><Th className="text-end">{d.signals.score}</Th>
                <Th className="text-end">{d.signals.rr}</Th><Th>{d.signals.detected}</Th><Th>{d.signals.validUntil}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const t = fmtDual(s.detected_at, locale);
                const expired = new Date(s.valid_until.endsWith("Z") || /[+-]\d\d:\d\d$/.test(s.valid_until) ? s.valid_until : `${s.valid_until}Z`) < new Date();
                return (
                  <Tr key={s.ref}>
                    <Td><Link href={`/signals/${s.ref}`} className="font-mono text-xs font-medium text-accent-text hover:underline" dir="ltr">{s.ref}</Link></Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{s.symbol}</span>
                        <DirectionTag direction={s.direction} option={Boolean(s.original.option)} d={d} />
                        {s.is_mock ? <span title={d.signals.mock}><FlaskConical className="size-3.5 text-warning-text" aria-label={d.signals.mock} /></span> : null}
                      </div>
                    </Td>
                    <Td className="font-mono text-xs text-ink-2">{s.strategy}</Td>
                    <Td><KindBadge kind={s.kind} d={d} /></Td>
                    <Td><SignalStatusBadge status={s.status} d={d} /></Td>
                    <Td className="text-end tnum">{fmtNumber(s.score, locale, { maximumFractionDigits: 0 })}</Td>
                    <Td className="text-end tnum">1:{fmtNumber(s.original.reward_risk, locale, { maximumFractionDigits: 2 })}</Td>
                    <Td className="whitespace-nowrap text-xs"><div className="tnum">{t.ny}</div><div className="text-muted tnum">{t.ry} {d.common.riyadh}</div></Td>
                    <Td className="whitespace-nowrap text-xs">
                      {["validated", "approved", "published"].includes(s.status)
                        ? expired ? <Badge tone="neutral">{d.signals.stale}</Badge> : <span className="tnum">{relativeFromNow(s.valid_until, locale)}</span>
                        : <span className="text-muted">—</span>}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
