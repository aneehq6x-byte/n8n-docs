import { CreditCard, RotateCcw } from "lucide-react";
import Link from "next/link";
import { refundPayment } from "@/app/actions";
import { ConfirmAction } from "@/components/action-form";
import { PaymentStatusBadge } from "@/components/status";
import { Badge, Card, EmptyState, PageHeader, Pagination, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { requireRole } from "@/lib/guard";
import { getI18n } from "@/lib/prefs";
import type { Page, PaymentRow, SystemInfo } from "@/lib/types";

export const metadata = { title: "Payments" };
const LIMIT = 50;
const STATUSES = ["all", "paid", "refunded", "pending"] as const;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string; offset?: string }> }) {
  await requireRole("admin");
  const [{ locale, d }, sp] = await Promise.all([getI18n(), searchParams]);
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : "all";
  const offset = Math.max(0, Number(sp.offset) || 0);
  const q = new URLSearchParams({ limit: String(LIMIT), offset: String(offset), ...(status !== "all" ? { status } : {}) });
  const [page, sys] = await Promise.all([api<Page<PaymentRow>>(`/admin/payments?${q}`), api<SystemInfo>("/admin/system")]);
  const href = (s: string, o = 0) => `/payments?status=${s}&offset=${o}`;
  const label = (s: string) => (s === "all" ? d.common.all : d.payments.statuses[s as PaymentRow["status"]]);

  return (
    <>
      <PageHeader title={d.payments.title} subtitle={d.payments.subtitle} />
      <Tabs active={status} items={STATUSES.map((s) => ({ key: s, label: label(s), href: href(s) }))} />
      <Card>
        {page.items.length === 0 ? <EmptyState icon={<CreditCard className="size-8" strokeWidth={1.5} />} title={d.common.empty} /> : (
          <Table caption={d.payments.title}>
            <thead>
              <tr>
                <Th>{d.payments.id}</Th><Th>{d.payments.user}</Th><Th className="text-end">{d.payments.amount}</Th>
                <Th>{d.common.status}</Th><Th>{d.payments.paidAt}</Th><Th>{d.payments.coupon}</Th>
                <Th>{d.payments.charge}</Th><Th><span className="sr-only">{d.common.actions}</span></Th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-mono text-xs">{p.id}</Td>
                  <Td><Link href={`/users/${p.user_id}`} className="text-accent-text hover:underline">#{p.user_id}</Link></Td>
                  <Td className="text-end font-medium tnum">{fmtNumber(p.amount, locale)} ⭐</Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <PaymentStatusBadge status={p.status} d={d} />
                      {p.is_recurring ? <Badge dot={false}>{d.payments.recurring}</Badge> : null}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-xs tnum">{fmtDateTime(p.paid_at ?? p.created_at, locale)}</Td>
                  <Td className="font-mono text-xs" dir="ltr">{p.coupon_code ?? "—"}</Td>
                  <Td className="max-w-40 truncate font-mono text-[0.6875rem] text-muted" dir="ltr" title={p.charge_id ?? ""}>{p.charge_id ?? "—"}</Td>
                  <Td className="text-end">
                    {p.status === "paid" ? (
                      sys.bot_configured ? (
                        <ConfirmAction
                          action={refundPayment} hidden={{ payment_id: String(p.id) }}
                          trigger={<><RotateCcw className="size-3.5" />{d.payments.refund}</>}
                          title={`${d.payments.refund} #${p.id} — ${fmtNumber(p.amount, locale)} ⭐`}
                          body={d.payments.refundConfirm} reasonLabel={d.payments.refundReason}
                          phrase="REFUND" phraseLabel="REFUND"
                          confirmLabel={d.payments.refund} cancelLabel={d.common.cancel} savedLabel={d.common.saved}
                        />
                      ) : <span className="text-[0.6875rem] text-muted">{d.system.bot}: {d.system.notConfigured}</span>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination total={page.total} limit={page.limit} offset={page.offset} hrefFor={(o) => href(status, o)}
          labels={{ previous: d.common.previous, next: d.common.next, showing: d.common.showing, of: d.common.of }} />
      </Card>
    </>
  );
}
