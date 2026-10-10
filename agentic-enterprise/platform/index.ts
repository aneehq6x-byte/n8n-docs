import type { AgentDefinition } from "./agent/agent-definition.ts";
import { ApprovalGate, defaultPolicy } from "./approval/approval-gate.ts";
import { AuditLog } from "./audit/audit-log.ts";
import type { Fixtures } from "./connectors/mock/fixtures.ts";
import { createMockConnectors, type MockConnectors } from "./connectors/mock/mock-connectors.ts";
import { loadConfig, type PlatformConfig } from "./config.ts";
import { openDatabase, type Database } from "./core/db.ts";
import { DEFAULT_HUMANS, HumanDirectory } from "./core/directory.ts";
import { KillSwitch } from "./core/kill-switch.ts";
import type { Human } from "./core/types.ts";
import { systemClock, type Clock } from "./core/util.ts";
import { EscalationService, InMemoryNotifier } from "./escalation/escalation.ts";
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
  register(...agents: AgentDefinition[]): Platform;
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
}

export function createPlatform(opts: CreatePlatformOptions = {}): Platform {
  const config = loadConfig(process.env, opts.config);
  const clock = opts.clock ?? systemClock;
  const db = openDatabase(config.DATABASE_PATH);
  const audit = new AuditLog(db, clock);
  audit.assertIntact();
  const directory = new HumanDirectory(opts.humans ?? DEFAULT_HUMANS);
  const gate = new ApprovalGate(db, audit, directory, defaultPolicy(config.APPROVAL_TTL_HOURS, config.DUAL_APPROVAL_THRESHOLD_USD), clock);
  const notifier = new InMemoryNotifier();
  const escalations = new EscalationService(db, audit, clock, notifier);
  const memory = new MemoryStore(db, audit, clock);
  const killSwitch = new KillSwitch({ envFlag: config.KILL_SWITCH, ...(opts.isolated ? {} : { flagFile: config.KILL_SWITCH_FILE }) });
  const connectors = createMockConnectors(gate, clock, opts.fixtures);
  const runtime =
    opts.runtime ??
    (config.AGENT_RUNTIME === "live"
      ? new ClaudeAgentRuntime({ model: config.AGENT_MODEL, maxTurns: config.AGENT_MAX_TURNS, maxBudgetUsd: config.AGENT_MAX_BUDGET_USD })
      : new ScriptedRuntime());

  let executor: ToolExecutor;
  const orchestrator = new Orchestrator({
    db, audit, gate, escalations, memory, killSwitch, directory, clock, runtime,
    executor: () => executor, maxAttempts: 3,
  });
  executor = new ToolExecutor({
    audit, gate, escalations, memory, killSwitch, connectors, clock,
    getTask: (id) => orchestrator.get(id),
    getAgent: (id) => orchestrator.agent(id),
  });

  const platform: Platform = {
    config, db, clock, audit, gate, escalations, notifier, memory, killSwitch, directory, connectors, executor, orchestrator, runtime,
    register(...agents) {
      for (const a of agents) orchestrator.register(a);
      return platform;
    },
    close() {
      db.close();
    },
  };
  return platform;
}

export { defineAgent, outcomeSchema, loadPrompt, type AgentDefinition, type AgentOutcome, type ToolGateway } from "./agent/agent-definition.ts";
export { defineTool, allow, type Guardrail, type ToolContext, type ToolCallResult } from "./tools/types.ts";
