import { ScrollText } from "lucide-react";
import { Button, Card, EmptyState, Input, PageHeader, Pagination, Table, Td, Th, Tr } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { requireRole } from "@/lib/guard";
import { getI18n } from "@/lib/prefs";
import type { AuditEntry, Page } from "@/lib/types";

export const metadata = { title: "Audit" };
const LIMIT = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; actor?: string; offset?: string }> }) {
  await requireRole("admin");
  const [{ locale, d }, sp] = await Promise.all([getI18n(), searchParams]);
  const action = (sp.action ?? "").slice(0, 64);
  const actor = (sp.actor ?? "").slice(0, 64);
  const offset = Math.max(0, Number(sp.offset) || 0);
  const params = new URLSearchParams({ ...(action ? { action } : {}), ...(actor ? { actor_q: actor } : {}), limit: String(LIMIT), offset: String(offset) });
  const page = await api<Page<AuditEntry>>(`/admin/audit?${params}`);
  const href = (o: number) => `/audit?${new URLSearchParams({ ...(action ? { action } : {}), ...(actor ? { actor } : {}), offset: String(o) })}`;

  return (
    <>
      <PageHeader title={d.audit.title} subtitle={d.audit.subtitle} />
      <Card>
        <form className="flex flex-wrap items-end gap-2 border-b border-line p-3" role="search">
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-ink-2">{d.audit.actionPrefix}
            <Input name="action" defaultValue={action} placeholder="payment." dir="ltr" />
          </label>
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-ink-2">{d.audit.actor}
            <Input name="actor" defaultValue={actor} placeholder="admin:" dir="ltr" />
          </label>
          <Button type="submit">{d.common.filter}</Button>
        </form>
        {page.items.length === 0 ? <EmptyState icon={<ScrollText className="size-8" strokeWidth={1.5} />} title={d.common.empty} /> : (
          <Table caption={d.audit.title}>
            <thead><tr><Th>{d.audit.at}</Th><Th>{d.audit.action}</Th><Th>{d.audit.actor}</Th><Th>{d.audit.target}</Th><Th>{d.audit.data}</Th></tr></thead>
            <tbody>
              {page.items.map((a) => (
                <Tr key={a.id}>
                  <Td className="whitespace-nowrap text-xs tnum">{fmtDateTime(a.at, locale)}</Td>
                  <Td className="font-mono text-xs font-medium" dir="ltr">{a.action}</Td>
                  <Td className="font-mono text-xs text-ink-2" dir="ltr">{a.actor}</Td>
                  <Td className="font-mono text-xs" dir="ltr">{a.target ?? "—"}</Td>
                  <Td className="max-w-md" dir="ltr">
                    {a.data ? <code className="block truncate text-[0.6875rem] text-muted" title={JSON.stringify(a.data)}>{JSON.stringify(a.data)}</code> : "—"}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination total={page.total} limit={page.limit} offset={page.offset} hrefFor={href}
          labels={{ previous: d.common.previous, next: d.common.next, showing: d.common.showing, of: d.common.of }} />
      </Card>
    </>
  );
}
