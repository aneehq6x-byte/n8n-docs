import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { AuditLog } from "../../platform/audit/audit-log.ts";
import { openDatabase } from "../../platform/core/db.ts";
import { systemClock } from "../../platform/core/util.ts";
import { done, testAgent, testPlatform } from "../helpers.ts";

/**
 * اختبارات انحدار للعيوب المثبتة في docs/architecture/CURRENT_STATE.md §6 (R1 إلى R8).
 * اختبارات التزامن تشغّل عمليات Node منفصلة حقيقية على ملف قاعدة بيانات واحد.
 */
const run = promisify(execFile);
const WORKER = join(import.meta.dirname, "../fixtures/worker.mts");
const worker = (...args: string[]) =>
  run(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", WORKER, ...args], { cwd: join(import.meta.dirname, "../.."), timeout: 60_000 });

describe("R1/R2: concurrent processes on one database", () => {
  it("loses no audit events and keeps a valid chain with 3 concurrent writers", async () => {
    const db = join(mkdtempSync(join(tmpdir(), "ae-")), "a.db");
    await Promise.all([worker("append", db, "200"), worker("append", db, "200"), worker("append", db, "200")]);
    const v = new AuditLog(openDatabase(db), systemClock).verify();
    expect(v).toMatchObject({ valid: true, entries: 600 });
  }, 90_000);

  it("R4: three concurrent workers execute each task exactly once", async () => {
    const db = join(mkdtempSync(join(tmpdir(), "ae-")), "t.db");
    await worker("seed", db, "30");
    await Promise.all([worker("drain", db), worker("drain", db), worker("drain", db)]);
    const d = openDatabase(db);
    const statuses = d.prepare("SELECT status, COUNT(*) n FROM tasks GROUP BY status").all();
    expect(statuses).toEqual([{ status: "completed", n: 30 }]);
    const claims = d.prepare("SELECT task_id, COUNT(*) n FROM audit_log WHERE action = 'task.transition' AND data LIKE '%\"to\":\"running\"%' GROUP BY task_id HAVING n > 1").all();
    expect(claims).toEqual([]);
    const screenings = d.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'tool.record_screening_result' AND outcome = 'success'").get() as { n: number };
    expect(screenings.n).toBe(30);
    expect(new AuditLog(d, systemClock).verify().valid).toBe(true);
  }, 120_000);
});

describe("R3/R8: crash recovery, timeouts and zombie runs", () => {
  it("a task stuck in running after a worker crash is recovered when its lease expires", async () => {
    const { p, clock } = testPlatform();
    p.register(testAgent());
    const t = p.orchestrator.submit({ type: "test.run", input: {}, originator: "u-requester" });
    const claimed = p.orchestrator.claim(t.id, 60_000)!; // العامل طالب بها ثم "مات"
    expect(claimed.status).toBe("running");
    expect(p.orchestrator.recoverExpiredLeases()).toHaveLength(0); // الإيجار ما يزال ساريًا
    clock.advanceHours(1);
    const [recovered] = p.orchestrator.recoverExpiredLeases();
    expect(recovered).toMatchObject({ status: "queued", attempts: 1, leaseId: null });
    expect(p.audit.query({ action: "task.lease_expired" })).toHaveLength(1);
    clock.advanceHours(1);
    await p.orchestrator.drain();
    expect(p.orchestrator.get(t.id).status).toBe("completed");
  });

  it("tool calls from a run whose lease was taken over are rejected as STALE_RUN", async () => {
    const { p, clock } = testPlatform();
    const agent = testAgent();
    p.register(agent);
    const t = p.orchestrator.submit({ type: "test.run", input: {}, originator: "u-requester" });
    const old = p.orchestrator.claim(t.id, 1_000)!;
    const zombie = p.executor.gatewayFor(agent, t.id, old.leaseId!);
    expect(await zombie.call("echo", { text: "alive" })).toMatchObject({ status: "ok" });
    clock.advanceHours(1);
    p.orchestrator.recoverExpiredLeases();
    p.orchestrator.claim(t.id, 60_000);
    expect(await zombie.call("echo", { text: "still here?" })).toMatchObject({ status: "denied", code: "STALE_RUN" });
  });

  it("a run exceeding its timeout is abandoned, and its late tool calls are refused", async () => {
    const { p } = testPlatform();
    let late: unknown;
    p.register(testAgent({
      timeoutMs: 50,
      policy: async ({ tools }) => {
        await new Promise((r) => setTimeout(r, 150));
        late = await tools.call("send_email", { to: "x@example.com", body: "late" });
        return done();
      },
    }));
    const t = p.orchestrator.submit({ type: "test.run", input: {}, originator: "u-requester" });
    const after = await p.orchestrator.run(t.id);
    expect(after).toMatchObject({ status: "queued", attempts: 1 });
    expect(after.lastError).toMatch(/timeout of 50 ms/);
    await new Promise((r) => setTimeout(r, 200));
    expect(late).toMatchObject({ status: "denied", code: "STALE_RUN" });
    expect(p.gate.list()).toHaveLength(0);
  });

  it("concurrent transitions are compare-and-set: a stale writer cannot overwrite", async () => {
    const { p } = testPlatform();
    p.register(testAgent());
    const t = p.orchestrator.submit({ type: "test.run", input: {}, originator: "u-requester" });
    expect(p.orchestrator.claim(t.id, 60_000)).not.toBeNull();
    expect(p.orchestrator.claim(t.id, 60_000)).toBeNull(); // المطالبة الثانية تفشل بأمان
  });
});
