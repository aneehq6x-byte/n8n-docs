import { Search, Users as UsersIcon } from "lucide-react";
import Link from "next/link";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Pagination, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate, fmtNumber, relativeFromNow } from "@/lib/format";
import { requireRole } from "@/lib/guard";
import { getI18n } from "@/lib/prefs";
import type { Page, UserRow } from "@/lib/types";

export const metadata = { title: "Subscribers" };
const LIMIT = 25;
const STATUSES = ["all", "active", "inactive", "blocked"] as const;

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; offset?: string }> }) {
  await requireRole("support");
  const [{ locale, d }, sp] = await Promise.all([getI18n(), searchParams]);
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : "all";
  const q = (sp.q ?? "").slice(0, 64);
  const offset = Math.max(0, Number(sp.offset) || 0);
  const qs = (o: Record<string, string | number>) => {
    const p = new URLSearchParams({ ...(q ? { q } : {}), status, ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) });
    return `/users?${p}`;
  };
  const page = await api<Page<UserRow>>(`/admin/users?${new URLSearchParams({ status, limit: String(LIMIT), offset: String(offset), ...(q ? { q } : {}) })}`);
  const now = new Date();

  return (
    <>
      <PageHeader title={d.users.title} subtitle={d.users.subtitle} />
      <Tabs
        active={status}
        items={[
          { key: "all", label: d.common.all, href: qs({ status: "all", offset: 0 }) },
          { key: "active", label: d.users.filterActive, href: qs({ status: "active", offset: 0 }) },
          { key: "inactive", label: d.users.filterInactive, href: qs({ status: "inactive", offset: 0 }) },
          { key: "blocked", label: d.users.filterBlocked, href: qs({ status: "blocked", offset: 0 }) },
        ]}
      />
      <Card>
        <form className="flex items-center gap-2 border-b border-line p-3" role="search">
          <input type="hidden" name="status" value={status} />
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input name="q" defaultValue={q} placeholder={d.users.searchPlaceholder} className="ps-9" aria-label={d.common.search} />
          </div>
          <Button type="submit">{d.common.search}</Button>
        </form>
        {page.items.length === 0 ? (
          <EmptyState icon={<UsersIcon className="size-8" strokeWidth={1.5} />} title={d.common.empty} />
        ) : (
          <Table caption={d.users.title}>
            <thead>
              <tr>
                <Th>{d.users.username}</Th><Th>{d.users.telegramId}</Th><Th>{d.common.status}</Th>
                <Th>{d.users.accessUntil}</Th><Th className="text-end">{d.users.paidTotal}</Th>
                <Th>{d.users.lastSeen}</Th><Th>{d.users.joined}</Th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((u) => {
                const active = u.access_until && new Date(u.access_until) > now;
                return (
                  <Tr key={u.id}>
                    <Td>
                      <Link href={`/users/${u.id}`} className="font-medium text-ink hover:text-accent-text hover:underline">
                        {u.username ? <bdi dir="ltr">@{u.username}</bdi> : `#${u.id}`}
                      </Link>
                      <span className="ms-2 text-[0.6875rem] uppercase text-muted">{u.language}</span>
                    </Td>
                    <Td className="font-mono text-xs text-ink-2" dir="ltr">{u.telegram_id}</Td>
                    <Td>
                      {u.is_blocked ? <Badge tone="critical">{d.users.blocked}</Badge>
                        : active ? <Badge tone="good">{d.common.active}</Badge> : <Badge>{d.common.inactive}</Badge>}
                    </Td>
                    <Td className="whitespace-nowrap text-xs tnum">{u.access_until ? fmtDate(u.access_until, locale) : "—"}</Td>
                    <Td className="text-end tnum">{u.paid_total ? `${fmtNumber(u.paid_total, locale)} ⭐` : "—"}</Td>
                    <Td className="whitespace-nowrap text-xs text-ink-2">{relativeFromNow(u.last_seen_at, locale)}</Td>
                    <Td className="whitespace-nowrap text-xs text-ink-2 tnum">{fmtDate(u.created_at, locale)}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination total={page.total} limit={page.limit} offset={page.offset} hrefFor={(o) => qs({ offset: o })}
          labels={{ previous: d.common.previous, next: d.common.next, showing: d.common.showing, of: d.common.of }} />
      </Card>
    </>
  );
}
