import { AlertTriangle, Plus } from "lucide-react";
import { createCoupon, toggleCoupon, updatePlan } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardBody, CardHeader, Field, Input, Notice, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate, fmtNumber } from "@/lib/format";
import { requireRole } from "@/lib/guard";
import { getI18n } from "@/lib/prefs";
import type { Coupon, Plan } from "@/lib/types";

export const metadata = { title: "Plans" };

export default async function PlansPage() {
  await requireRole("admin");
  const { locale, d } = await getI18n();
  const [plans, coupons] = await Promise.all([api<Plan[]>("/admin/plans"), api<Coupon[]>("/admin/coupons")]);

  return (
    <>
      <PageHeader title={d.plans.title} subtitle={d.plans.subtitle} />
      <Notice tone="warning" icon={<AlertTriangle className="size-4" />} className="mb-6">{d.plans.placeholderWarning}</Notice>

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.code}>
            <CardHeader
              title={<span className="flex items-center gap-2">{locale === "ar" ? p.name_ar : p.name_en}<span className="font-mono text-xs font-normal text-muted">{p.code}</span></span>}
              subtitle={`${fmtNumber(p.days, locale)} ${d.plans.days} · ${p.is_trial ? d.plans.trial : p.recurring ? d.plans.recurring : d.plans.fixed}`}
              actions={<Badge tone={p.active ? "good" : "neutral"}>{p.active ? d.common.active : d.common.inactive}</Badge>}
            />
            <CardBody>
              <p className="mb-4 text-3xl font-semibold tracking-tight text-ink">
                {p.is_trial ? "0" : fmtNumber(p.stars, locale)} <span className="text-base font-normal text-muted">⭐</span>
              </p>
              <ActionForm action={updatePlan} submitLabel={d.common.save} variant="secondary" size="sm" savedLabel={d.common.saved}>
                <input type="hidden" name="code" value={p.code} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label={d.plans.price} htmlFor={`price-${p.code}`} hint={p.recurring ? d.plans.capHint : undefined}>
                    <Input id={`price-${p.code}`} name="price_stars" type="number" min={1} max={p.recurring ? 10000 : 100000}
                      defaultValue={p.is_trial ? "" : p.stars} disabled={p.is_trial} dir="ltr" />
                  </Field>
                  <Field label={d.plans.aiQuota} htmlFor={`quota-${p.code}`}>
                    <Input id={`quota-${p.code}`} name="ai_daily_quota" type="number" min={0} max={1000} defaultValue={p.ai_daily_quota} dir="ltr" />
                  </Field>
                  <Field label={d.plans.nameAr} htmlFor={`ar-${p.code}`}><Input id={`ar-${p.code}`} name="name_ar" defaultValue={p.name_ar} dir="rtl" required /></Field>
                  <Field label={d.plans.nameEn} htmlFor={`en-${p.code}`}><Input id={`en-${p.code}`} name="name_en" defaultValue={p.name_en} dir="ltr" required /></Field>
                </div>
                <label className="flex items-center gap-2 text-xs text-ink-2">
                  <input type="checkbox" name="active" defaultChecked={p.active} className="size-4 accent-[var(--accent)]" />
                  {d.common.active}
                </label>
              </ActionForm>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={d.plans.coupons} />
          <Table caption={d.plans.coupons}>
            <thead>
              <tr><Th>{d.plans.code}</Th><Th>{d.plans.percentOff}</Th><Th>{d.plans.redemptions}</Th><Th>{d.plans.validUntil}</Th><Th>{d.plans.plansScope}</Th><Th>{d.common.status}</Th><Th /></tr>
            </thead>
            <tbody>
              {coupons.length === 0 ? <tr><Td colSpan={7} className="text-center text-muted">{d.common.empty}</Td></tr> : coupons.map((c) => (
                <Tr key={c.code}>
                  <Td className="font-mono text-xs font-medium" dir="ltr">{c.code}</Td>
                  <Td className="tnum">{fmtNumber(c.percent_off / 100, locale, { style: "percent" })}</Td>
                  <Td className="tnum"><bdi dir="ltr">{fmtNumber(c.redemptions, locale)}{c.max_redemptions ? ` / ${fmtNumber(c.max_redemptions, locale)}` : ""}</bdi></Td>
                  <Td className="whitespace-nowrap text-xs tnum">{c.valid_until ? fmtDate(c.valid_until, locale) : "—"}</Td>
                  <Td className="text-xs">{c.plan_codes?.join(", ") ?? d.plans.allPlans}</Td>
                  <Td><Badge tone={c.active ? "good" : "neutral"}>{c.active ? d.common.active : d.common.inactive}</Badge></Td>
                  <Td className="text-end">
                    <ActionForm action={toggleCoupon} submitLabel={c.active ? d.plans.deactivate : d.plans.activate} variant="ghost" size="sm" savedLabel={d.common.saved}>
                      <input type="hidden" name="code" value={c.code} />
                      <input type="hidden" name="active" value={c.active ? "0" : "1"} />
                    </ActionForm>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-2"><Plus className="size-4 text-muted" />{d.plans.newCoupon}</span>} />
          <CardBody>
            <ActionForm action={createCoupon} submitLabel={d.plans.create} savedLabel={d.common.saved} resetOnSuccess>
              <Field label={d.plans.code} htmlFor="c-code"><Input id="c-code" name="code" required pattern="[A-Za-z0-9_\-]{3,32}" dir="ltr" className="uppercase" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`${d.plans.percentOff} %`} htmlFor="c-pct"><Input id="c-pct" name="percent_off" type="number" min={1} max={99} required dir="ltr" /></Field>
                <Field label={d.plans.maxRedemptions} htmlFor="c-max"><Input id="c-max" name="max_redemptions" type="number" min={1} dir="ltr" /></Field>
              </div>
              <Field label={d.plans.validUntil} htmlFor="c-until"><Input id="c-until" name="valid_until" type="date" dir="ltr" /></Field>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-xs font-medium text-ink-2">{d.plans.plansScope}</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {plans.filter((p) => !p.is_trial).map((p) => (
                    <label key={p.code} className="flex items-center gap-1.5 text-xs text-ink-2">
                      <input type="checkbox" name="plan_codes" value={p.code} className="size-3.5 accent-[var(--accent)]" />{locale === "ar" ? p.name_ar : p.name_en}
                    </label>
                  ))}
                </div>
              </fieldset>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
