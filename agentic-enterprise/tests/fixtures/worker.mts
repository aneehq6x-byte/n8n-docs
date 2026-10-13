/**
 * عامل مستقل يُشغَّل كعملية منفصلة في اختبارات التزامن (tests/platform/hardening.test.ts).
 *   append <db> <n>   يكتب n حدثًا في audit
 *   seed <db> <n>     ينشئ n مهمة فحص عقوبات
 *   drain <db>        يشغّل الطابور حتى يفرغ
 */
import { ALL_AGENTS } from "../../agents/index.ts";
import { HmacFileAnchor, NoAnchor, parseAnchorKey } from "../../platform/audit/anchor.ts";
import { AuditLog } from "../../platform/audit/audit-log.ts";
import { openDatabase } from "../../platform/core/db.ts";
import { systemClock } from "../../platform/core/util.ts";
import { createPlatform } from "../../platform/index.ts";

const [mode, db, n] = process.argv.slice(2);
if (mode === "append") {
  const key = process.env.AUDIT_ANCHOR_KEY;
  const log = new AuditLog(openDatabase(db!), systemClock, key ? new HmacFileAnchor(`${db}.anchor.jsonl`, parseAnchorKey(key)) : new NoAnchor());
  for (let i = 0; i < Number(n); i++) log.append({ actor: { type: "system", id: `pid-${process.pid}` }, action: "probe", outcome: "info", data: { i } });
} else {
  const p = createPlatform({ config: { DATABASE_PATH: db!, KILL_SWITCH: false, APPROVER_AUTH: "trusted" } as never, isolated: true }).register(...ALL_AGENTS);
  if (mode === "seed") for (let i = 0; i < Number(n); i++) p.orchestrator.submit({ type: "compliance.screen", input: { partyType: "supplier", partyId: "sup-001" }, originator: "u-requester" });
  if (mode === "drain") await p.orchestrator.drain(1000);
  p.close();
}
