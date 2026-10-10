import type { AgentDefinition, AgentOutcome } from "../agent/agent-definition.ts";
import type { ApprovalGate } from "../approval/approval-gate.ts";
import type { AuditLog } from "../audit/audit-log.ts";
import type { Connectors } from "../connectors/types.ts";
import type { Database } from "../core/db.ts";
import { parseJson } from "../core/db.ts";
import type { HumanDirectory } from "../core/directory.ts";
import { PlatformError } from "../core/errors.ts";
import type { KillSwitch } from "../core/kill-switch.ts";
import type { JsonObject } from "../core/types.ts";
import { hashObject, newId, type Clock } from "../core/util.ts";
import type { EscalationService } from "../escalation/escalation.ts";
import type { MemoryStore } from "../memory/memory-store.ts";
import type { AgentRuntime } from "../runtime/runtime.ts";
import { detectInjection } from "../security/untrusted.ts";
import type { ToolExecutor } from "../tools/executor.ts";
import { TERMINAL, TRANSITIONS, type Handoff, type Task, type TaskStatus } from "./task.ts";

/**
 * المنسق: يستلم المهام ويوزعها على الوكلاء حسب نوعها، ويتتبع حالتها، وينفّذ الإحالات بين الوكلاء،
 * ويستأنف المهام بعد القرارات البشرية.
 *
 * ضمانات:
 * - idempotency: المهمة ذات المفتاح نفسه لا تُنشأ مرتين، فإعادة الإرسال آمنة.
 * - كل انتقال حالة يُتحقق منه مقابل TRANSITIONS ويُسجَّل في audit log.
 * - مخرج الوكيل يُتحقق منه بـ outputSchema. المخرج غير الصالح فشل وليس نجاحًا.
 * - الإحالة لا تُقبل إلا إلى أنواع مهام مدرجة في canHandoffTo للوكيل.
 * - المحتوى الخارجي في المهمة يُفحص بحثًا عن حقن تعليمات قبل التشغيل.
 */

export interface SubmitTaskInput {
  type: string;
  input: JsonObject;
  originator: string;
  idempotencyKey?: string;
  parentId?: string;
}

export interface OrchestratorDeps {
  db: Database;
  audit: AuditLog;
  gate: ApprovalGate;
  escalations: EscalationService;
  memory: MemoryStore;
  killSwitch: KillSwitch;
  directory: HumanDirectory;
  clock: Clock;
  executor: () => ToolExecutor;
  connectors: Connectors;
  runtime: AgentRuntime;
  maxAttempts: number;
}

export class Orchestrator {
  private readonly agents = new Map<string, AgentDefinition>();
  private readonly routes = new Map<string, string>();

  constructor(private readonly deps: OrchestratorDeps) {
    deps.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, assignee TEXT NOT NULL,
        input TEXT NOT NULL, output TEXT, parent_id TEXT, originator TEXT NOT NULL, attempts INTEGER NOT NULL,
        idempotency_key TEXT UNIQUE, pending_handoffs TEXT NOT NULL, last_error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
    `);
  }

  register(agent: AgentDefinition): void {
    if (this.agents.has(agent.id)) throw new Error(`Agent ${agent.id} already registered`);
    for (const type of agent.handles) {
      const existing = this.routes.get(type);
      if (existing) throw new Error(`Task type ${type} already routed to ${existing}`);
      this.routes.set(type, agent.id);
    }
    this.agents.set(agent.id, agent);
  }

  agent(id: string): AgentDefinition {
    const a = this.agents.get(id);
    if (!a) throw new PlatformError("NOT_FOUND", `Agent ${id} not registered`);
    return a;
  }

  listAgents(): AgentDefinition[] {
    return [...this.agents.values()];
  }

  submit(input: SubmitTaskInput): Task {
    if (input.idempotencyKey) {
      const existing = this.deps.db.prepare("SELECT * FROM tasks WHERE idempotency_key = ?").get(input.idempotencyKey);
      if (existing) return rowToTask(existing as Record<string, unknown>);
    }
    const assignee = this.routes.get(input.type);
    if (!assignee) throw new PlatformError("NOT_FOUND", `No agent handles task type ${input.type}`);
    if (!this.deps.directory.has(input.originator)) throw new PlatformError("NOT_FOUND", `Unknown originator ${input.originator}`);
    const now = this.deps.clock.now().toISOString();
    const task: Task = {
      id: newId("task"), type: input.type, status: "queued", assignee, input: input.input, output: null,
      parentId: input.parentId ?? null, originator: input.originator, attempts: 0,
      idempotencyKey: input.idempotencyKey ?? null, pendingHandoffs: [], lastError: null, createdAt: now, updatedAt: now,
    };
    this.deps.db
      .prepare(`INSERT INTO tasks VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, '[]', NULL, ?, ?)`)
      .run(task.id, task.type, task.status, task.assignee, JSON.stringify(task.input), task.parentId, task.originator, task.idempotencyKey, now, now);
    this.deps.audit.append({
      actor: { type: input.parentId ? "agent" : "human", id: input.parentId ? this.get(input.parentId).assignee : input.originator },
      action: "task.submitted", target: task.id, taskId: task.id, outcome: "success",
      data: { type: task.type, assignee, parentId: task.parentId },
    });
    return task;
  }

  get(id: string): Task {
    const r = this.deps.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    if (!r) throw new PlatformError("NOT_FOUND", `Task ${id} not found`);
    return rowToTask(r as Record<string, unknown>);
  }

  list(filter: { status?: TaskStatus; parentId?: string } = {}): Task[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter.status) (clauses.push("status = ?"), params.push(filter.status));
    if (filter.parentId) (clauses.push("parent_id = ?"), params.push(filter.parentId));
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.deps.db.prepare(`SELECT * FROM tasks ${where} ORDER BY created_at, rowid`).all(...params).map((r) => rowToTask(r as Record<string, unknown>));
  }

  /** يشغّل كل المهام في الطابور حتى يفرغ، بما فيها المهام الناتجة عن الإحالات. */
  async drain(maxTasks = 100): Promise<Task[]> {
    const done: Task[] = [];
    for (let i = 0; i < maxTasks; i++) {
      const next = this.list({ status: "queued" })[0];
      if (!next || this.deps.killSwitch.isEngaged()) break;
      done.push(await this.run(next.id));
    }
    return done;
  }

  async run(taskId: string): Promise<Task> {
    this.deps.killSwitch.assertNotEngaged();
    const task = this.get(taskId);
    const agent = this.agent(task.assignee);
    this.transition(task, "running", { attempts: task.attempts + 1 });

    // فحص المحتوى الخارجي قبل أن يراه أي نموذج. الاشتباه يُسجَّل ويُمرَّر كإشارة للوكيل وللحواجز.
    const injection = scanUntrusted(task.input);
    if (injection.length) {
      this.deps.audit.append({ actor: { type: "system", id: "orchestrator" }, action: "security.injection_suspected", taskId, outcome: "info", data: { findings: injection as unknown as JsonObject[] } as unknown as JsonObject });
    }

    const executor = this.deps.executor();
    let outcome: AgentOutcome;
    try {
      const result = await this.deps.runtime.run({
        agent, task: this.get(taskId), tools: executor.gatewayFor(agent, taskId), toolList: executor.toolsFor(agent),
      });
      const parsed = agent.outputSchema.safeParse(result.outcome);
      if (!parsed.success) throw new Error(`Invalid agent output: ${parsed.error.message.slice(0, 500)}`);
      outcome = parsed.data;
      if (result.usage) this.deps.audit.append({ actor: { type: "agent", id: agent.id }, action: "agent.usage", taskId, outcome: "info", data: result.usage as unknown as JsonObject });
    } catch (err) {
      return this.handleRunError(taskId, agent, err);
    }

    const current = this.get(taskId);
    if (current.status !== "running") return current; // أوقفها شيء آخر أثناء التشغيل
    return this.settle(current, agent, outcome);
  }

  /** يطبّق قرارًا بشريًا على طلب موافقة، ثم ينفّذ الإجراء أو يصعّد، ويغلق المهمة إن اكتملت. */
  async decideApproval(approvalId: string, humanId: string, decision: "approve" | "reject", comment = ""): Promise<Task> {
    const req = this.deps.gate.decide(approvalId, humanId, decision, comment);
    const task = this.get(req.taskId);
    if (req.status === "pending") return task; // ينتظر موافقًا ثانيًا
    if (req.status === "rejected") {
      this.deps.escalations.raise({ taskId: task.id, raisedBy: "orchestrator", reason: "approval_rejected", severity: "medium", toRole: this.agent(task.assignee).defaultEscalationRole, summary: `Approval ${approvalId} rejected by ${humanId}: ${comment}` });
      return this.escalateIfWaiting(task.id);
    }
    const result = await this.deps.executor().executeApproved(approvalId);
    if (result.status !== "ok") return this.escalateIfWaiting(task.id, JSON.stringify(result));
    return this.completeIfApprovalsDone(task.id);
  }

  /** يحوّل الموافقات المنتهية إلى تصعيدات. يُشغَّل دوريًا (cron) في الإنتاج. */
  sweepExpiredApprovals(): number {
    const expired = this.deps.gate.expireStale();
    for (const a of expired) {
      const task = this.get(a.taskId);
      this.deps.escalations.raise({ taskId: task.id, raisedBy: "orchestrator", reason: "approval_expired", severity: "medium", toRole: this.agent(task.assignee).defaultEscalationRole, summary: `Approval ${a.id} expired without decision` });
      this.escalateIfWaiting(task.id);
    }
    return expired.length;
  }

  /** استئناف بشري لمهمة مصعّدة: إعادتها للطابور، أو إغلاقها بقرار. */
  resolveEscalated(taskId: string, humanId: string, action: "requeue" | "complete" | "reject" | "cancel", note: string): Task {
    const task = this.get(taskId);
    if (task.status !== "escalated") throw new PlatformError("INVALID_TRANSITION", `Task ${taskId} is ${task.status}, not escalated`);
    for (const e of this.deps.escalations.list({ taskId, status: "open" })) this.deps.escalations.resolve(e.id, humanId, note);
    this.deps.audit.append({ actor: { type: "human", id: humanId }, action: `task.${action}`, target: taskId, taskId, outcome: "success", data: { note } });
    const to: TaskStatus = action === "requeue" ? "queued" : action === "complete" ? "completed" : action === "reject" ? "rejected" : "cancelled";
    return this.transition(task, to);
  }

  private settle(task: Task, agent: AgentDefinition, outcome: AgentOutcome): Task {
    const output = outcome as unknown as JsonObject;
    const violations = agent.outcomeGuard?.(outcome, { task, connectors: this.deps.connectors }) ?? [];
    if (violations.length > 0) {
      this.deps.audit.append({ actor: { type: "system", id: "orchestrator" }, action: "agent.outcome_guard", taskId: task.id, outcome: "denied", data: { violations } });
      this.deps.escalations.raise({ taskId: task.id, raisedBy: "orchestrator", reason: "guardrail_triggered", severity: "high", toRole: agent.defaultEscalationRole, summary: `Agent outcome rejected by outcome guard: ${violations.join("; ")}`, context: { violations } });
    }
    const handoffs = violations.length > 0 ? [] : outcome.handoffs.filter((h) => this.allowHandoff(task, agent, h));
    const pendingApprovals = this.deps.gate.list({ taskId: task.id, status: "pending" });
    const openEscalations = this.deps.escalations.list({ taskId: task.id, status: "open" });

    // الحالة تُشتق من الوقائع المسجلة، لا من ادعاء الوكيل وحده.
    let next: TaskStatus;
    if (openEscalations.length > 0 || outcome.status === "escalated") next = "escalated";
    else if (pendingApprovals.length > 0) next = "awaiting_approval";
    else if (outcome.status === "needs_approval") {
      // الوكيل ادعى أنه طلب موافقة ولا يوجد طلب فعلي: تناقض يُصعَّد.
      this.deps.escalations.raise({ taskId: task.id, raisedBy: "orchestrator", reason: "runtime_error", severity: "medium", toRole: agent.defaultEscalationRole, summary: "Agent reported needs_approval but no approval request exists" });
      next = "escalated";
    } else if (outcome.status === "rejected") next = "rejected";
    else next = "completed";

    if (outcome.status === "escalated" && openEscalations.length === 0) {
      this.deps.escalations.raise({ taskId: task.id, raisedBy: agent.id, reason: "agent_requested", severity: "medium", toRole: agent.defaultEscalationRole, summary: outcome.summary });
    }

    const nowHandoffs = handoffs.filter((h) => h.when === "now");
    const deferred = handoffs.filter((h) => h.when === "after_approval");
    const updated = this.transition(task, next, { output, pendingHandoffs: next === "awaiting_approval" ? deferred : [] });
    for (const h of nowHandoffs) this.spawn(updated, h);
    if (next === "completed") for (const h of deferred) this.spawn(updated, h);
    return updated;
  }

  private completeIfApprovalsDone(taskId: string): Task {
    const task = this.get(taskId);
    const outstanding = this.deps.gate.list({ taskId }).filter((a) => a.status === "pending" || a.status === "approved");
    if (outstanding.length > 0 || task.status !== "awaiting_approval") return task;
    const done = this.transition(task, "completed", { pendingHandoffs: [] });
    for (const h of task.pendingHandoffs) this.spawn(done, h);
    return done;
  }

  private escalateIfWaiting(taskId: string, lastError?: string): Task {
    const task = this.get(taskId);
    return task.status === "awaiting_approval" ? this.transition(task, "escalated", lastError ? { lastError } : {}) : task;
  }

  private allowHandoff(task: Task, agent: AgentDefinition, h: Handoff): boolean {
    if (agent.canHandoffTo.includes(h.taskType) && this.routes.has(h.taskType)) return true;
    this.deps.audit.append({ actor: { type: "agent", id: agent.id }, action: "task.handoff", taskId: task.id, outcome: "denied", data: { taskType: h.taskType, reason: "not in canHandoffTo" } });
    return false;
  }

  private spawn(parent: Task, h: Handoff): Task {
    return this.submit({ type: h.taskType, input: h.input, originator: parent.originator, parentId: parent.id, idempotencyKey: `${parent.id}:${h.taskType}:${hashObject(h.input).slice(0, 16)}` });
  }

  private handleRunError(taskId: string, agent: AgentDefinition, err: unknown): Task {
    const message = err instanceof Error ? err.message : String(err);
    const task = this.get(taskId);
    this.deps.audit.append({ actor: { type: "system", id: "orchestrator" }, action: "task.run_error", taskId, outcome: "failure", data: { error: message } });
    if (this.deps.killSwitch.isEngaged()) return this.transition(task, "failed", { lastError: message });
    if (task.attempts >= this.deps.maxAttempts) {
      this.deps.escalations.raise({ taskId, raisedBy: "orchestrator", reason: "max_attempts_exceeded", severity: "high", toRole: agent.defaultEscalationRole, summary: `Task failed ${task.attempts} times: ${message}` });
      return this.transition(task, "escalated", { lastError: message });
    }
    return this.transition(task, "queued", { lastError: message });
  }

  private transition(task: Task, to: TaskStatus, patch: Partial<Pick<Task, "output" | "attempts" | "pendingHandoffs" | "lastError">> = {}): Task {
    if (!TRANSITIONS[task.status].includes(to))
      throw new PlatformError("INVALID_TRANSITION", `Task ${task.id}: ${task.status} → ${to} is not allowed`);
    const now = this.deps.clock.now().toISOString();
    const next: Task = { ...task, ...patch, status: to, updatedAt: now };
    this.deps.db
      .prepare("UPDATE tasks SET status = ?, output = ?, attempts = ?, pending_handoffs = ?, last_error = ?, updated_at = ? WHERE id = ?")
      .run(to, next.output ? JSON.stringify(next.output) : null, next.attempts, JSON.stringify(next.pendingHandoffs), next.lastError, now, task.id);
    this.deps.audit.append({ actor: { type: "system", id: "orchestrator" }, action: "task.transition", target: task.id, taskId: task.id, outcome: "info", data: { from: task.status, to } });
    if (TERMINAL.includes(to)) this.deps.memory.forgetTask(task.id);
    return next;
  }
}

function scanUntrusted(input: JsonObject) {
  const items = Array.isArray(input.untrusted) ? (input.untrusted as Array<{ source?: string; text?: string }>) : [];
  return items.flatMap((u) => detectInjection(String(u.text ?? "")).map((f) => ({ source: String(u.source ?? "unknown"), ...f })));
}

function rowToTask(r: Record<string, unknown>): Task {
  return {
    id: String(r.id), type: String(r.type), status: r.status as TaskStatus, assignee: String(r.assignee),
    input: parseJson<JsonObject>(r.input), output: r.output ? parseJson<JsonObject>(r.output) : null,
    parentId: (r.parent_id as string | null) ?? null, originator: String(r.originator), attempts: Number(r.attempts),
    idempotencyKey: (r.idempotency_key as string | null) ?? null, pendingHandoffs: parseJson<Handoff[]>(r.pending_handoffs),
    lastError: (r.last_error as string | null) ?? null, createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}
