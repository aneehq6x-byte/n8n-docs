import { ArrowLeft, ArrowRight, Ban, Gift, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { blockUser, grantAccess } from "@/app/actions";
import { ActionForm, ConfirmAction } from "@/components/action-form";
import { PaymentStatusBadge } from "@/components/status";
import { Badge, Card, CardBody, CardHeader, Field, KeyValue, Select, Table, Td, Textarea, Th, Tr, type Tone } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { requireRole } from "@/lib/guard";
import type { Dict } from "@/lib/i18n";
import { getI18n } from "@/lib/prefs";
import { hasRole } from "@/lib/roles";
import type { Plan, UserDetail } from "@/lib/types";

export const metadata = { title: "Subscriber" };

type SubKey = keyof Dict["users"]["subStatus"];
const SUB_TONE: Record<SubKey, Tone> = { active: "good", cancelled: "accent", expired: "neutral", refunded: "serious" };

/** State as of now, even if the expiry job has not run yet. */
function effectiveStatus(status: string, endsAt: string, now: Date): SubKey {
  const lapsed = (status === "active" || status === "cancelled") && new Date(endsAt) <= now;
  return (lapsed ? "expired" : status) as SubKey;
}

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole("support");
  const [{ locale, d }, { id }] = await Promise.all([getI18n(), params]);
  if (!/^\d+$/.test(id)) notFound();
  let u: UserDetail;
  try {
    u = await api<UserDetail>(`/admin/users/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const isAdmin = hasRole(session.role, "admin");
  const plans = isAdmin ? (await api<Plan[]>("/admin/plans")).filter((p) => p.active && !p.is_trial) : [];
  const Back = locale === "ar" ? ArrowRight : ArrowLeft;
  const now = new Date();
  const active = u.access_until && new Date(u.access_until) > now;

  return (
    <>
      <Link href="/users" className="mb-4 inline-flex items-center gap-1.5 text-xs text-ink-2 hover:text-ink"><Back className="size-3.5" />{d.users.title}</Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-ink">{u.username ? <bdi dir="ltr">@{u.username}</bdi> : `#${u.id}`}</h1>
        {u.is_blocked ? <Badge tone="critical">{d.users.blocked}</Badge> : active ? <Badge tone="good">{d.common.active}</Badge> : <Badge>{d.common.inactive}</Badge>}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardBody>
              <KeyValue items={[
                { k: d.users.telegramId, v: <span className="font-mono" dir="ltr">{u.telegram_id}</span> },
                { k: d.users.accessUntil, v: u.access_until ? fmtDateTime(u.access_until, locale) : "—" },
                { k: d.users.paidTotal, v: <span className="tnum">{fmtNumber(u.paid_total, locale)} ⭐</span> },
                { k: d.users.joined, v: fmtDateTime(u.created_at, locale) },
                { k: d.users.lastSeen, v: fmtDateTime(u.last_seen_at, locale) },
                { k: d.users.terms, v: u.accepted_terms ? d.common.yes : d.common.no },
              ]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={d.users.subscriptions} />
            <Table caption={d.users.subscriptions}>
              <thead><tr><Th>{d.users.plan}</Th><Th>{d.users.period}</Th><Th>{d.common.status}</Th><Th>{d.users.autoRenew}</Th><Th>{d.payments.id}</Th></tr></thead>
              <tbody>
                {u.subscriptions.length === 0 ? <tr><Td colSpan={5} className="text-center text-muted">{d.common.empty}</Td></tr> : u.subscriptions.map((s) => {
                  const st = effectiveStatus(s.status, s.ends_at, now);
                  return (
                    <Tr key={s.id}>
                      <Td className="font-mono text-xs">{s.plan}</Td>
                      <Td className="whitespace-nowrap text-xs tnum">{fmtDate(s.starts_at, locale)}<span className="mx-1.5 text-muted">–</span>{fmtDate(s.ends_at, locale)}</Td>
                      <Td><Badge tone={SUB_TONE[st] ?? "neutral"}>{d.users.subStatus[st] ?? s.status}</Badge></Td>
                      <Td className="text-xs">{s.auto_renew ? d.common.yes : d.common.no}</Td>
                      <Td className="font-mono text-xs">{s.payment_id ?? "—"}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title={d.users.payments} />
            <Table caption={d.users.payments}>
              <thead><tr><Th>{d.payments.id}</Th><Th className="text-end">{d.payments.amount}</Th><Th>{d.common.status}</Th><Th>{d.payments.paidAt}</Th><Th>{d.payments.coupon}</Th></tr></thead>
              <tbody>
                {u.payments.length === 0 ? <tr><Td colSpan={5} className="text-center text-muted">{d.common.empty}</Td></tr> : u.payments.map((p) => (
                  <Tr key={p.id}>
                    <Td className="font-mono text-xs">{p.id}</Td>
                    <Td className="text-end tnum">{fmtNumber(p.amount, locale)} ⭐</Td>
                    <Td><PaymentStatusBadge status={p.status} d={d} /></Td>
                    <Td className="whitespace-nowrap text-xs tnum">{fmtDateTime(p.paid_at, locale)}</Td>
                    <Td className="font-mono text-xs" dir="ltr">{p.coupon_code ?? "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title={d.users.channels} />
            <CardBody>
              {u.channels.length === 0 ? <p className="text-sm text-muted">{d.users.notMember}</p> : (
                <ul className="flex flex-col gap-2 text-xs">
                  {u.channels.map((c) => (
                    <li key={c.chat_id} className="flex items-center justify-between gap-2">
                      <span className="font-mono" dir="ltr">{c.chat_id}</span>
                      <Badge tone={c.is_member ? "good" : "neutral"}>{c.is_member ? d.users.member : d.users.notMember}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          {isAdmin ? (
            <>
              <Card>
                <CardHeader title={<span className="inline-flex items-center gap-2"><Gift className="size-4 text-muted" />{d.users.grant}</span>} subtitle={d.users.grantHint} />
                <CardBody>
                  <ActionForm action={grantAccess} submitLabel={d.users.grant} variant="secondary" savedLabel={d.common.saved} resetOnSuccess>
                    <input type="hidden" name="user_id" value={u.id} />
                    <Field label={d.users.grantPlan} htmlFor="plan_code">
                      <Select id="plan_code" name="plan_code">
                        {plans.map((p) => <option key={p.code} value={p.code}>{locale === "ar" ? p.name_ar : p.name_en} ({fmtNumber(p.days, locale)} {d.plans.days})</option>)}
                      </Select>
                    </Field>
                    <Field label={d.common.reason} htmlFor="grant_reason"><Textarea id="grant_reason" name="reason" required minLength={3} maxLength={300} rows={2} /></Field>
                  </ActionForm>
                </CardBody>
              </Card>
              <Card>
                <CardBody className="flex items-center justify-between gap-3">
                  <span className="text-sm text-ink-2">{u.is_blocked ? d.users.unblock : d.users.block}</span>
                  <ConfirmAction
                    action={blockUser} hidden={{ user_id: String(u.id), blocked: u.is_blocked ? "0" : "1" }}
                    trigger={u.is_blocked ? <><ShieldCheck className="size-3.5" />{d.users.unblock}</> : <><Ban className="size-3.5" />{d.users.block}</>}
                    triggerVariant={u.is_blocked ? "secondary" : "danger"} variant={u.is_blocked ? "primary" : "danger"}
                    title={u.is_blocked ? d.users.unblock : d.users.block} reasonLabel={d.common.reason}
                    confirmLabel={d.common.confirm} cancelLabel={d.common.cancel} savedLabel={d.common.saved}
                  />
                </CardBody>
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
