import { AlertOctagon, CheckCircle2, CircleSlash, Power, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { retryDeadLetter, setKillSwitch, setPublishMode, toggleStrategy } from "@/app/actions";
import { ActionForm, ConfirmAction } from "@/components/action-form";
import { Badge, Card, CardBody, CardHeader, Field, Notice, PageHeader, Select, Table, Td, Th, Tr } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { requireRole } from "@/lib/guard";
import { getI18n } from "@/lib/prefs";
import { hasRole } from "@/lib/roles";
import type { SystemInfo } from "@/lib/types";

export const metadata = { title: "System" };

function Status({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return ok ? <Badge tone="good"><CheckCircle2 className="size-3" />{yes}</Badge> : <Badge tone="neutral"><CircleSlash className="size-3" />{no}</Badge>;
}

export default async function SystemPage() {
  const session = await requireRole("support");
  const { locale, d } = await getI18n();
  const s = await api<SystemInfo>("/admin/system");
  const admin = hasRole(session.role, "admin");
  const ob = d.system.outboxStatus;

  return (
    <>
      <PageHeader title={d.system.title} subtitle={d.system.subtitle} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className={s.kill_switch ? "border-critical/50" : undefined}>
          <CardHeader title={<span className="inline-flex items-center gap-2"><Power className="size-4 text-muted" />{d.system.killSwitch}</span>} subtitle={d.system.killHint}
            actions={s.kill_switch ? <Badge tone="critical"><AlertOctagon className="size-3" />ON</Badge> : <Badge tone="good">OFF</Badge>} />
          <CardBody>
            {admin ? (
              <ConfirmAction
                action={setKillSwitch} hidden={{ on: s.kill_switch ? "0" : "1" }}
                trigger={s.kill_switch ? d.system.killOff : d.system.killOn}
                triggerVariant={s.kill_switch ? "primary" : "danger"} triggerSize="md" variant={s.kill_switch ? "primary" : "danger"}
                title={s.kill_switch ? d.system.killOff : d.system.killOn} body={d.system.killHint}
                phrase={s.kill_switch ? "RESUME" : "STOP"} phraseLabel={s.kill_switch ? d.system.killConfirmOff : d.system.killConfirm}
                confirmLabel={d.common.confirm} cancelLabel={d.common.cancel} savedLabel={d.common.saved}
              />
            ) : <p className="text-xs text-muted">{d.common.forbidden}</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={d.system.publishMode} subtitle={`${d.system.defaultMode}: ${s.publish_mode_default === "human_approval" ? d.system.human : d.system.automatic}`} />
          <CardBody>
            {admin ? (
              <ActionForm action={setPublishMode} submitLabel={d.common.save} variant="secondary" savedLabel={d.common.saved}>
                <Field label={d.system.publishMode} htmlFor="mode">
                  <Select id="mode" name="mode" defaultValue={s.publish_mode}>
                    <option value="human_approval">{d.system.human}</option>
                    <option value="automatic">{d.system.automatic}</option>
                  </Select>
                </Field>
              </ActionForm>
            ) : <Badge tone="accent">{s.publish_mode === "human_approval" ? d.system.human : d.system.automatic}</Badge>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={d.system.safety} />
          <CardBody>
            {s.safety_problems.length ? (
              <ul className="flex flex-col gap-2">
                {s.safety_problems.map((p) => (
                  <li key={p}><Notice tone="critical" icon={<ShieldAlert className="size-4" />}><span dir="ltr">{p}</span></Notice></li>
                ))}
              </ul>
            ) : <Badge tone="good"><CheckCircle2 className="size-3" />{d.system.safetyOk}</Badge>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={d.system.strategies} subtitle={d.system.strategyHint} />
          <CardBody className="flex flex-col divide-y divide-line">
            {s.strategies.map((st) => (
              <div key={st.name} className="flex items-center justify-between gap-3 py-2.5">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-sm">{st.name}</span>
                  <Badge tone={st.disabled ? "neutral" : "good"}>{st.disabled ? d.common.disabled : d.common.enabled}</Badge>
                </span>
                {admin ? (
                  <ActionForm action={toggleStrategy} submitLabel={st.disabled ? d.plans.activate : d.plans.deactivate} variant="ghost" size="sm" savedLabel={d.common.saved}>
                    <input type="hidden" name="name" value={st.name} />
                    <input type="hidden" name="disabled" value={st.disabled ? "0" : "1"} />
                  </ActionForm>
                ) : null}
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={d.system.integrations} />
          <CardBody>
            <dl className="flex flex-col gap-3 text-sm">
              {([
                [d.system.env, <Badge key="e" tone={s.env === "prod" ? "good" : "warning"} dot={false}>{s.env}</Badge>],
                [d.system.dataProvider, <Badge key="p" tone={s.market_data_provider === "mock" ? "warning" : "good"}>{s.market_data_provider}</Badge>],
                [d.system.maxAge, <span key="a" className="tnum">{s.max_quote_age_seconds} {d.system.seconds}</span>],
                [d.system.bot, <Status key="b" ok={s.bot_configured} yes={d.system.configured} no={d.system.notConfigured} />],
                [d.system.channel, <Status key="c" ok={s.private_channel_configured} yes={d.system.configured} no={d.system.notConfigured} />],
                [d.system.ai, <Status key="i" ok={s.ai_configured} yes={d.system.configured} no={d.system.notConfigured} />],
              ] as const).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3"><dt className="text-ink-2">{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={d.system.outbox} />
          <CardBody className="grid grid-cols-2 gap-3">
            {(["pending", "sent", "failed", "dead"] as const).map((k) => (
              <div key={k} className="rounded-lg bg-surface-2 px-3 py-2.5">
                <p className="text-xs text-muted">{ob[k]}</p>
                <p className={`mt-1 text-xl font-semibold tnum ${k === "dead" && (s.outbox.dead ?? 0) > 0 ? "text-critical-text" : "text-ink"}`}>{fmtNumber(s.outbox[k] ?? 0, locale)}</p>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader title={d.system.deadLetters} />
          {s.dead_letters.length === 0 ? <CardBody><p className="text-sm text-muted">{d.common.empty}</p></CardBody> : (
            <Table caption={d.system.deadLetters}>
              <thead><tr><Th>ID</Th><Th>Key</Th><Th>Chat</Th><Th className="text-end">{d.system.attempts}</Th><Th>{d.system.lastError}</Th><Th>{d.common.createdAt}</Th><Th /></tr></thead>
              <tbody>
                {s.dead_letters.map((m) => (
                  <Tr key={m.id}>
                    <Td className="font-mono text-xs">{m.id}</Td>
                    <Td className="font-mono text-xs" dir="ltr">{m.dedup_key}</Td>
                    <Td className="font-mono text-xs" dir="ltr">{m.chat_id}</Td>
                    <Td className="text-end tnum">{m.attempts}</Td>
                    <Td className="max-w-md text-xs text-critical-text" dir="ltr"><span className="inline-flex items-start gap-1.5"><XCircle className="mt-px size-3.5 shrink-0" />{m.last_error}</span></Td>
                    <Td className="whitespace-nowrap text-xs tnum">{fmtDateTime(m.created_at, locale)}</Td>
                    <Td className="text-end">
                      {admin ? (
                        <ActionForm action={retryDeadLetter} submitLabel={<><RefreshCw className="size-3.5" />{d.common.retry}</>} variant="secondary" size="sm" savedLabel={d.common.saved}>
                          <input type="hidden" name="id" value={m.id} />
                        </ActionForm>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
