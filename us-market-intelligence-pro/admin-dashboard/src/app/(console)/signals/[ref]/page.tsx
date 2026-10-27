import { ArrowLeft, ArrowRight, CheckCircle2, Clock, Database, FlaskConical, Lock, XCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { decideSignal, updateSignalStatus } from "@/app/actions";
import { ActionForm, ConfirmAction } from "@/components/action-form";
import { PriceLadder } from "@/components/price-ladder";
import { DirectionTag, KindBadge, SignalStatusBadge } from "@/components/status";
import { Badge, Card, CardBody, CardHeader, Field, Input, KeyValue, Notice, Select } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmtDual, fmtNumber, fmtPrice, relativeFromNow } from "@/lib/format";
import { requireRole } from "@/lib/guard";
import { getI18n } from "@/lib/prefs";
import type { SignalDetail, SignalStatus } from "@/lib/types";

const TRACKABLE: SignalStatus[] = ["active", "target1_hit", "target2_hit", "stopped", "cancelled"];

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }) {
  return { title: (await params).ref };
}

function Dual({ at, locale, riyadh }: { at: string | null; locale: "ar" | "en"; riyadh: string }) {
  const t = fmtDual(at, locale);
  return <span className="tnum">{t.ny} <span className="text-muted">· {t.ry} {riyadh}</span></span>;
}

export default async function SignalDetailPage({ params }: { params: Promise<{ ref: string }> }) {
  await requireRole("analyst");
  const [{ locale, d }, { ref }] = await Promise.all([getI18n(), params]);
  let s: SignalDetail;
  try {
    s = await api<SignalDetail>(`/admin/signals/${encodeURIComponent(ref)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const o = s.original;
  const opt = o.option;
  const Back = locale === "ar" ? ArrowRight : ArrowLeft;
  const track = s.allowed_transitions.filter((t) => TRACKABLE.includes(t));
  const isQueue = s.status === "validated";

  return (
    <>
      <Link href="/signals" className="mb-4 inline-flex items-center gap-1.5 text-xs text-ink-2 hover:text-ink">
        <Back className="size-3.5" />{d.signals.title}
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-xl font-semibold text-ink" dir="ltr">{s.ref}</h1>
        <SignalStatusBadge status={s.status} d={d} />
        <KindBadge kind={s.kind} d={d} />
        {s.is_mock ? <Badge tone="warning"><FlaskConical className="size-3" />{d.signals.mock}</Badge> : null}
        <span className="ms-auto flex items-center gap-2 text-lg font-semibold text-ink">
          {s.symbol}<DirectionTag direction={s.direction} option={Boolean(opt)} d={d} />
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader title={d.signals.plan} subtitle={`${d.signals.strategy}: ${s.strategy} · ${d.signals.score} ${fmtNumber(s.score, locale, { maximumFractionDigits: 0 })}/100`} />
            <CardBody className="flex flex-col gap-5">
              <PriceLadder o={o} locale={locale}
                labels={{ stop: d.signals.stop, entry: d.signals.entry, t1: d.signals.target1, t2: d.signals.target2, ref: d.signals.reference }} />
              <KeyValue items={[
                { k: d.signals.entry, v: <bdi dir="ltr" className="tnum">{fmtPrice(o.entry_low, locale)} – {fmtPrice(o.entry_high, locale)}</bdi> },
                { k: d.signals.reference, v: <span className="tnum">{fmtPrice(o.reference_price, locale)}</span> },
                { k: d.signals.stop, v: <span className="tnum">{fmtPrice(o.stop, locale)}</span> },
                { k: d.signals.target1, v: <span className="tnum">{fmtPrice(o.target1, locale)}</span> },
                { k: d.signals.target2, v: <span className="tnum">{fmtPrice(o.target2, locale)}</span> },
                { k: d.signals.rr, v: <span className="tnum">1:{fmtNumber(o.reward_risk, locale, { maximumFractionDigits: 2 })}</span> },
                { k: d.signals.invalidation, v: o.invalidation },
              ]} />
              <div className="rounded-lg bg-surface-2 px-4 py-3">
                <p className="text-xs text-muted">{d.signals.reason}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink">{o.reason}</p>
              </div>
            </CardBody>
          </Card>

          {opt ? (
            <Card>
              <CardHeader title={d.signals.option} subtitle={<span dir="ltr" className="font-mono">{opt.contract}</span>} />
              <CardBody>
                <KeyValue items={[
                  { k: d.signals.expiry, v: <span className="tnum">{opt.expiry}</span> },
                  { k: d.signals.strike, v: <span className="tnum">{fmtPrice(opt.strike, locale)} {opt.right === "C" ? "CALL" : "PUT"}</span> },
                  { k: d.signals.bidAsk, v: <bdi dir="ltr" className="tnum">{fmtPrice(opt.bid, locale)} / {fmtPrice(opt.ask, locale)}</bdi> },
                  { k: d.signals.entryEst, v: <span className="tnum">{fmtPrice(opt.entry_est, locale)}</span> },
                  { k: d.signals.maxLoss, v: <span className="tnum">${fmtPrice(opt.max_loss_per_contract, locale)}</span> },
                  { k: d.signals.breakeven, v: <span className="tnum">{fmtPrice(opt.breakeven, locale)}</span> },
                  { k: "Δ / IV", v: <span className="tnum">{fmtNumber(opt.delta, locale, { maximumFractionDigits: 2 })} / {fmtNumber(opt.iv, locale, { style: "percent", maximumFractionDigits: 1 })}</span> },
                  { k: `${d.signals.oi} / ${d.signals.volume}`, v: <span className="tnum">{fmtNumber(opt.oi, locale)} / {fmtNumber(opt.volume, locale)}</span> },
                ]} />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title={d.signals.history} />
            <CardBody>
              {s.history.length === 0 ? <p className="text-sm text-muted">{d.signals.noHistory}</p> : (
                <ol className="relative flex flex-col gap-4 border-s border-line ps-5">
                  {s.history.map((h, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -start-[1.6rem] top-1 size-2.5 rounded-full border-2 border-surface bg-accent" aria-hidden />
                      <div className="flex flex-wrap items-center gap-2">
                        <SignalStatusBadge status={h.to as SignalStatus} d={d} />
                        <span className="text-xs text-muted"><Dual at={h.at} locale={locale} riyadh={d.common.riyadh} /></span>
                      </div>
                      <p className="mt-1 text-xs text-ink-2">
                        <span dir="ltr" className="font-mono">{h.actor}</span>
                        {h.note ? <> — {h.note}</> : null}
                        {h.data && typeof h.data.r_net === "number" ? <> — <strong className="tnum">{fmtNumber(h.data.r_net, locale, { signDisplay: "exceptZero", maximumFractionDigits: 2 })}R</strong></> : null}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title={isQueue ? d.signals.decision : d.signals.track} />
            <CardBody className="flex flex-col gap-4">
              {isQueue ? (
                <>
                  <p className="text-xs leading-relaxed text-ink-2">{s.kind === "published" ? d.signals.decisionHint : d.signals.paperHint}</p>
                  <ActionForm action={decideSignal} submitLabel={<><CheckCircle2 className="size-4" />{d.signals.approvePublish}</>} savedLabel={d.common.saved}>
                    <input type="hidden" name="ref" value={s.ref} />
                    <input type="hidden" name="decision" value="approve_publish" />
                  </ActionForm>
                  {s.kind === "published" ? (
                    <ActionForm action={decideSignal} submitLabel={d.signals.approveOnly} variant="secondary" savedLabel={d.common.saved}>
                      <input type="hidden" name="ref" value={s.ref} />
                      <input type="hidden" name="decision" value="approve_only" />
                    </ActionForm>
                  ) : null}
                  <div><ConfirmAction action={decideSignal} hidden={{ ref: s.ref, decision: "reject" }}
                    trigger={<><XCircle className="size-4" />{d.signals.reject}</>} triggerSize="md"
                    title={`${d.signals.reject} ${s.ref}`} body={d.signals.rejectConfirm} reasonLabel={d.signals.rejectReason}
                    confirmLabel={d.signals.reject} cancelLabel={d.common.cancel} savedLabel={d.common.saved} /></div>
                </>
              ) : track.length ? (
                <ActionForm action={updateSignalStatus} submitLabel={d.common.save} savedLabel={d.common.saved}>
                  <input type="hidden" name="ref" value={s.ref} />
                  <Field label={d.signals.to} htmlFor="to">
                    <Select id="to" name="to" defaultValue={track[0]}>
                      {track.map((t) => <option key={t} value={t}>{d.signals.status[t]}</option>)}
                    </Select>
                  </Field>
                  <Field label={d.signals.rNet} hint={d.signals.rNetHint} htmlFor="r_net">
                    <Input id="r_net" name="r_net" type="number" step="0.01" min={-20} max={50} dir="ltr" inputMode="decimal" />
                  </Field>
                  <Field label={d.common.note} htmlFor="note">
                    <Input id="note" name="note" maxLength={500} />
                  </Field>
                </ActionForm>
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted"><Lock className="size-4" />{d.signals.closedNoActions}</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={d.common.details} />
            <CardBody>
              <dl className="flex flex-col gap-3 text-sm">
                <div><dt className="text-xs text-muted">{d.signals.detected}</dt><dd className="mt-0.5 text-xs"><Dual at={s.detected_at} locale={locale} riyadh={d.common.riyadh} /></dd></div>
                <div><dt className="text-xs text-muted">{d.signals.published}</dt><dd className="mt-0.5 text-xs"><Dual at={s.published_at} locale={locale} riyadh={d.common.riyadh} /></dd></div>
                <div>
                  <dt className="text-xs text-muted">{d.signals.validUntil}</dt>
                  <dd className="mt-0.5 flex items-center gap-1.5 text-xs"><Clock className="size-3.5 text-muted" /><Dual at={s.valid_until} locale={locale} riyadh={d.common.riyadh} />
                    <span className="text-muted">({relativeFromNow(s.valid_until, locale)})</span></dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{d.signals.dataSource}</dt>
                  <dd className="mt-0.5 flex items-center gap-1.5 text-xs"><Database className="size-3.5 text-muted" /><span dir="ltr">{o.data_source}</span> · <Dual at={o.data_as_of} locale={locale} riyadh={d.common.riyadh} /></dd>
                </div>
                <div><dt className="text-xs text-muted">{d.signals.createdBy}</dt><dd className="mt-0.5 font-mono text-xs" dir="ltr">{s.created_by}</dd></div>
                {o.features && Object.keys(o.features).length ? (
                  <div>
                    <dt className="text-xs text-muted">{d.signals.features}</dt>
                    <dd className="mt-1 flex flex-wrap gap-1.5" dir="ltr">
                      {Object.entries(o.features).map(([k, v]) => (
                        <span key={k} className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[0.6875rem] text-ink-2">{k}={typeof v === "number" ? Number(v.toFixed(3)) : String(v)}</span>
                      ))}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </CardBody>
          </Card>
          {s.is_mock && s.kind === "published" ? <Notice tone="warning">{d.alerts.mock_data}</Notice> : null}
        </div>
      </div>
    </>
  );
}
