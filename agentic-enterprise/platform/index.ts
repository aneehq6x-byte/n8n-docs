import type { AgentDefinition } from "./agent/agent-definition.ts";
import { ApprovalGate, defaultPolicy } from "./approval/approval-gate.ts";
import { HmacFileAnchor, NoAnchor, parseAnchorKey, type AuditAnchor } from "./audit/anchor.ts";
import { AuditLog } from "./audit/audit-log.ts";
import type { Fixtures } from "./connectors/mock/fixtures.ts";
import { createMockConnectors, type MockConnectors } from "./connectors/mock/mock-connectors.ts";
import { loadConfig, type PlatformConfig } from "./config.ts";
import { openDatabase, type Database } from "./core/db.ts";
import { DEFAULT_HUMANS, HumanDirectory } from "./core/directory.ts";
import { KillSwitch } from "./core/kill-switch.ts";
import type { Human } from "./core/types.ts";
import type { Task } from "./orchestrator/task.ts";
import { systemClock, type Clock } from "./core/util.ts";
import { EscalationService, InMemoryNotifier } from "./escalation/escalation.ts";
import { ApproverKeyRegistry, DevSigner, type DecisionProof } from "./identity/approver-keys.ts";
import { MemoryStore } from "./memory/memory-store.ts";
import { Orchestrator } from "./orchestrator/orchestrator.ts";
import { ClaudeAgentRuntime } from "./runtime/claude-runtime.ts";
import { ScriptedRuntime, type AgentRuntime } from "./runtime/runtime.ts";
import { ToolExecutor } from "./tools/executor.ts";

/**
 * حاوية المنصة: تبني كل المكونات وتربطها. نقطة الدخول الوحيدة لتشغيل النظام أو اختباره.
 */
export interface Platform {
  config: PlatformConfig;
  db: Database;
  clock: Clock;
  audit: AuditLog;
  gate: ApprovalGate;
  escalations: EscalationService;
  notifier: InMemoryNotifier;
  memory: MemoryStore;
  killSwitch: KillSwitch;
  directory: HumanDirectory;
  connectors: MockConnectors;
  executor: ToolExecutor;
  orchestrator: Orchestrator;
  runtime: AgentRuntime;
  keys: ApproverKeyRegistry;
  register(...agents: AgentDefinition[]): Platform;
  /** يبني إثبات قرار موقّعًا بمفاتيح التطوير (يتطلب devKeys). */
  signDecision(approvalId: string, humanId: string, decision: "approve" | "reject", comment?: string): DecisionProof;
  /** قرار بشري كامل عبر المنسق، موقّع تلقائيًا في وضع signed عند توفر مفاتيح التطوير. */
  decide(approvalId: string, humanId: string, decision: "approve" | "reject", comment?: string): Promise<Task>;
  close(): void;
}

export interface CreatePlatformOptions {
  config?: Partial<PlatformConfig>;
  clock?: Clock;
  fixtures?: Fixtures;
  humans?: Human[];
  runtime?: AgentRuntime;
  /** لا يُقرأ ملف علَم الإيقاف من القرص (للاختبارات المعزولة). */
  isolated?: boolean;
  /** فتح المنصة رغم تلف audit log للتشخيص فقط. يُفعّل الإيقاف الطارئ في الذاكرة، فلا يعمل أي وكيل. */
  forensic?: boolean;
  /** تثبيت audit صريح (للاختبارات). الافتراضي: ملف HMAC إن وُجد المفتاح، وإلا بلا تثبيت. */
  anchor?: AuditAnchor;
  /** يولّد مفاتيح موافقين في الذاكرة ويسجلها (اختبارات وتطوير فقط). يتيح p.decide بتوقيع حقيقي. */
  devKeys?: boolean;
}

export function createPlatform(opts: CreatePlatformOptions = {}): Platform {
  const config = loadConfig(process.env, opts.config);
  const clock = opts.clock ?? systemClock;
  const db = openDatabase(config.DATABASE_PATH);
  const anchor: AuditAnchor =
    opts.anchor ??
    (config.AUDIT_ANCHOR_KEY ? new HmacFileAnchor(config.AUDIT_ANCHOR_FILE, parseAnchorKey(config.AUDIT_ANCHOR_KEY)) : new NoAnchor());
  if (config.AUDIT_ANCHOR_REQUIRED && anchor.kind === "none") throw new Error("AUDIT_ANCHOR_REQUIRED=true but AUDIT_ANCHOR_KEY is not set");
  const audit = new AuditLog(db, clock, anchor);
  // الإقلاع يرفض سجلًا تالفًا (fail-closed). الوضع الجنائي يسمح بالفتح للتشخيص فقط، مع إيقاف طارئ إلزامي.
  if (!opts.forensic) audit.assertIntact();
  const directory = new HumanDirectory(opts.humans ?? DEFAULT_HUMANS);
  const keys = new ApproverKeyRegistry(db, audit, directory, clock);
  const gate = new ApprovalGate(db, audit, directory, defaultPolicy(config.APPROVAL_TTL_HOURS, config.DUAL_APPROVAL_THRESHOLD_USD), clock, { mode: config.APPROVER_AUTH, keys });
  const devSigner = opts.devKeys ? new DevSigner(keys, (opts.humans ?? DEFAULT_HUMANS).map((h) => h.id)) : null;
  const notifier = new InMemoryNotifier();
  const escalations = new EscalationService(db, audit, clock, notifier);
  const memory = new MemoryStore(db, audit, clock);
  const killSwitch = new KillSwitch({ envFlag: config.KILL_SWITCH, ...(opts.isolated ? {} : { flagFile: config.KILL_SWITCH_FILE }) });
  if (opts.forensic && !audit.verify().valid) killSwitch.engage("forensic mode: audit chain broken", false);
  const connectors = createMockConnectors(gate, clock, opts.fixtures);
  const runtime =
    opts.runtime ??
    (config.AGENT_RUNTIME === "live"
      ? new ClaudeAgentRuntime({ model: config.AGENT_MODEL, maxTurns: config.AGENT_MAX_TURNS, maxBudgetUsd: config.AGENT_MAX_BUDGET_USD })
      : new ScriptedRuntime());

  let executor: ToolExecutor;
  const orchestrator = new Orchestrator({
    db, audit, gate, escalations, memory, killSwitch, directory, clock, runtime,
    executor: () => executor, connectors, maxAttempts: 3, defaultTimeoutMs: config.AGENT_TIMEOUT_MS,
  });
  executor = new ToolExecutor({
    audit, gate, escalations, memory, killSwitch, connectors, clock,
    getTask: (id) => orchestrator.get(id),
    getAgent: (id) => orchestrator.agent(id),
  });

  const platform: Platform = {
    config, db, clock, audit, gate, escalations, notifier, memory, killSwitch, directory, connectors, executor, orchestrator, runtime,
    keys,
    register(...agents) {
      for (const a of agents) orchestrator.register(a);
      return platform;
    },
    signDecision(approvalId, humanId, decision, comment = "") {
      if (!devSigner) throw new Error("signDecision requires createPlatform({ devKeys: true })");
      return devSigner.sign({ approvalId, humanId, decision, comment, payloadHash: gate.get(approvalId).payloadHash, issuedAt: clock.now().toISOString() });
    },
    decide(approvalId, humanId, decision, comment = "") {
      const proof = config.APPROVER_AUTH === "signed" && devSigner ? platform.signDecision(approvalId, humanId, decision, comment) : undefined;
      return orchestrator.decideApproval(approvalId, humanId, decision, comment, proof);
    },
    close() {
      db.close();
    },
  };
  return platform;
}

export { defineAgent, outcomeSchema, loadPrompt, type AgentDefinition, type AgentOutcome, type ToolGateway } from "./agent/agent-definition.ts";
export { defineTool, allow, type Guardrail, type ToolContext, type ToolCallResult } from "./tools/types.ts";
