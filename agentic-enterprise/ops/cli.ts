import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { ALL_AGENTS } from "../agents/index.ts";
import { resolvePotentialMatch } from "../agents/compliance/human-actions.ts";
import { loadConfig } from "../platform/config.ts";
import { defaultFixtures, type Fixtures } from "../platform/connectors/mock/fixtures.ts";
import { isPlatformError } from "../platform/core/errors.ts";
import type { JsonObject } from "../platform/core/types.ts";
import { createPlatform, type Platform } from "../platform/index.ts";
import { computeMetrics } from "./metrics.ts";

/**
 * أداة المشغّل البشري. كل أمر يفتح المنصة على قاعدة البيانات الدائمة، وينفّذ، ثم يحفظ حالة الأنظمة الوهمية.
 *
 *   npm run ops -- status                                   لوحة الحالة والتنبيهات
 *   npm run ops -- metrics [--json]                         المؤشرات الكاملة
 *   npm run ops -- submit <taskType> '<json>' --as <human>  إنشاء مهمة
 *   npm run ops -- run                                      تشغيل الطابور وتحويل الموافقات المنتهية إلى تصعيد
 *   npm run ops -- approvals                                طابور الموافقات
 *   npm run ops -- approve|reject <approvalId> --as <human> [--comment "…"]
 *   npm run ops -- escalations                              التصعيدات المفتوحة
 *   npm run ops -- resolve <taskId> --as <human> --action requeue|complete|reject|cancel --note "…"
 *   npm run ops -- clear-match <screeningId> --as <human> --status false_positive|confirmed_match --note "…"
 *   npm run ops -- kill "<reason>" --as <human>             إيقاف طارئ فوري
 *   npm run ops -- release --as <human>                     رفع الإيقاف (لا يستأنف التنفيذ تلقائيًا)
 *   npm run ops -- resume --as <human>                      تنفيذ الموافقات المعلّقة بعد رفع الإيقاف
 *   npm run ops -- audit verify | audit tail [n] | audit task <taskId>
 *   npm run ops -- reset-demo --confirm                     حذف البيانات المحلية (بيئة التطوير فقط)
 *
 * تنبيه: --as غير موثّق الآن، ويُفترض تشغيل الأداة في بيئة موثوقة. ربط الهوية بـ SSO وMFA "مستقبلي" (runbook §8).
 */

const config = loadConfig();
const STATE_FILE = `${dirname(config.DATABASE_PATH)}/mock-state.json`;

function loadState(): Fixtures {
  return existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as Fixtures) : defaultFixtures();
}

function saveState(p: Platform): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(p.connectors.state, null, 2));
  renameSync(tmp, STATE_FILE); // كتابة ذرية: لا ملف حالة نصف مكتوب عند الانقطاع
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    as: { type: "string" },
    comment: { type: "string", default: "" },
    note: { type: "string", default: "" },
    action: { type: "string" },
    status: { type: "string" },
    json: { type: "boolean", default: false },
    confirm: { type: "boolean", default: false },
  },
});
const [cmd, ...args] = positionals;

function requireHuman(p: Platform): string {
  if (!values.as) throw new Error("--as <humanId> is required for this command");
  p.directory.get(values.as);
  return values.as;
}

function table(rows: Array<Record<string, unknown>>): void {
  if (rows.length === 0) return console.log("  (none)");
  console.table(rows);
}

async function main(): Promise<void> {
  if (cmd === "reset-demo") {
    if (!values.confirm) throw new Error("reset-demo deletes local data; pass --confirm");
    for (const f of [config.DATABASE_PATH, `${config.DATABASE_PATH}-wal`, `${config.DATABASE_PATH}-shm`, STATE_FILE]) if (existsSync(f)) rmSync(f);
    return console.log("Local database and mock state removed.");
  }

  // أوامر القراءة والإيقاف تعمل حتى مع سجل تالف، للتشخيص. كل ما عداها يرفض الإقلاع.
  const forensic = ["status", "metrics", "audit", "kill"].includes(cmd ?? "");
  const p = createPlatform({ fixtures: loadState(), forensic }).register(...ALL_AGENTS);
  try {
    switch (cmd) {
      case "status": {
        const m = computeMetrics(p);
        console.log(`\nKill switch: ${m.killSwitch ? "ENGAGED" : "off"}   Audit: ${m.audit.valid ? "intact" : "BROKEN"} (${m.audit.entries} entries)   Runtime: ${p.runtime.kind}`);
        console.log("\nTasks by status:"), table([m.tasks.byStatus]);
        console.log(`Approvals: ${m.approvals.pending} pending (oldest ${m.approvals.oldestPendingHours ?? "-"}h), ${m.approvals.approvedNotExecuted} approved-not-executed`);
        console.log(`Escalations: ${m.escalations.open} open, ${m.escalations.overdue} overdue`);
        console.log("\nAlerts:");
        if (m.alerts.length === 0) console.log("  none");
        for (const a of m.alerts) console.log(`  [${a.level.toUpperCase()}] ${a.code}: ${a.message}\n      → ${a.action}`);
        break;
      }
      case "metrics": {
        const m = computeMetrics(p);
        console.log(values.json ? JSON.stringify(m, null, 2) : m);
        break;
      }
      case "submit": {
        const [type, json] = args;
        if (!type || !json) throw new Error("usage: submit <taskType> '<json input>' --as <human>");
        const t = p.orchestrator.submit({ type, input: JSON.parse(json) as JsonObject, originator: requireHuman(p) });
        console.log(`Submitted ${t.id} (${t.type}) → ${t.assignee}`);
        break;
      }
      case "run": {
        const expired = p.orchestrator.sweepExpiredApprovals();
        const done = await p.orchestrator.drain();
        console.log(`Expired approvals escalated: ${expired}`);
        table(done.map((t) => ({ task: t.id, type: t.type, status: t.status, summary: String(t.output?.summary ?? t.lastError ?? "").slice(0, 90) })));
        break;
      }
      case "approvals":
        table(p.gate.list({ status: "pending" }).map((a) => ({ id: a.id, action: a.actionType, required: a.requiredApprovals, have: a.decisions.length, roles: a.allowedRoles.join("|"), expires: a.expiresAt.slice(0, 16), summary: a.summary.slice(0, 110) })));
        break;
      case "approve":
      case "reject": {
        const id = args[0];
        if (!id) throw new Error(`usage: ${cmd} <approvalId> --as <human>`);
        if (cmd === "reject" && !values.comment) throw new Error("A rejection needs --comment explaining why");
        const t = await p.orchestrator.decideApproval(id, requireHuman(p), cmd, values.comment);
        console.log(`Approval ${id}: ${p.gate.get(id).status}. Task ${t.id}: ${t.status}`);
        break;
      }
      case "escalations":
        table(p.escalations.list({ status: "open" }).map((e) => ({ id: e.id, task: e.taskId, severity: e.severity, role: e.toRole, reason: e.reason, due: e.dueAt.slice(0, 16), summary: e.summary.slice(0, 100) })));
        break;
      case "resolve": {
        const action = values.action as "requeue" | "complete" | "reject" | "cancel";
        if (!args[0] || !["requeue", "complete", "reject", "cancel"].includes(action) || !values.note) throw new Error("usage: resolve <taskId> --as <human> --action requeue|complete|reject|cancel --note '…'");
        console.log(`Task ${args[0]} → ${p.orchestrator.resolveEscalated(args[0], requireHuman(p), action, values.note).status}`);
        break;
      }
      case "clear-match": {
        const status = values.status as "false_positive" | "confirmed_match";
        if (!args[0] || !["false_positive", "confirmed_match"].includes(status) || !values.note) throw new Error("usage: clear-match <screeningId> --as <human> --status false_positive|confirmed_match --note '…'");
        console.log(resolvePotentialMatch(p, args[0], requireHuman(p), status, values.note));
        break;
      }
      case "kill": {
        const who = requireHuman(p);
        const reason = args.join(" ") || "unspecified";
        p.killSwitch.engage(`${who}: ${reason}`);
        p.audit.append({ actor: { type: "human", id: who }, action: "ops.kill_switch.engage", outcome: "success", data: { reason } });
        console.log(`EMERGENCY STOP ENGAGED by ${who}: ${reason}\nFlag file: ${config.KILL_SWITCH_FILE}`);
        break;
      }
      case "release": {
        const who = requireHuman(p);
        if (!p.directory.get(who).roles.includes("platform_operator")) throw new Error("Only a platform_operator can release the emergency stop");
        const audit = p.audit.verify();
        if (!audit.valid) throw new Error(`Refusing to release: audit chain broken at seq ${audit.firstBrokenSeq}`);
        p.killSwitch.release();
        p.audit.append({ actor: { type: "human", id: who }, action: "ops.kill_switch.release", outcome: "success", data: { note: values.note } });
        console.log("Emergency stop released. Queued tasks resume on the next `run`; approved actions need an explicit `resume`.");
        break;
      }
      case "resume": {
        const who = requireHuman(p);
        const done = await p.orchestrator.executePendingApproved();
        p.audit.append({ actor: { type: "human", id: who }, action: "ops.resume_approved", outcome: "success", data: { executed: done.length } });
        table(done.map((t) => ({ task: t.id, type: t.type, status: t.status })));
        break;
      }
      case "audit": {
        const [sub, arg] = args;
        if (sub === "verify") {
          const v = p.audit.verify();
          console.log(v.valid ? `Audit chain intact: ${v.entries} entries` : `AUDIT CHAIN BROKEN at seq ${v.firstBrokenSeq}: ${v.reason}`);
          if (!v.valid) process.exitCode = 3;
        } else if (sub === "tail" || sub === "task") {
          const all = sub === "task" ? p.audit.query({ taskId: arg }) : p.audit.query().slice(-Number(arg ?? 20));
          table(all.map((e) => ({ seq: e.seq, ts: e.ts.slice(0, 19), actor: `${e.actor.type}:${e.actor.id}`, action: e.action, outcome: e.outcome, data: JSON.stringify(e.data).slice(0, 80) })));
        } else throw new Error("usage: audit verify | audit tail [n] | audit task <taskId>");
        break;
      }
      default:
        console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.includes("npm run ops")).map((l) => l.replace(/^ \* {2}/, "")).join("\n"));
    }
  } finally {
    saveState(p);
    p.close();
  }
}

main().catch((err) => {
  console.error(isPlatformError(err) ? `${err.code}: ${err.message}` : `Error: ${(err as Error).message}`);
  process.exit(1);
});
