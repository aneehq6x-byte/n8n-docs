import { readFileSync } from "node:fs";
import { z } from "zod";
import type { HumanRole } from "../core/types.ts";
import type { MemoryPolicy } from "../memory/memory-store.ts";
import type { Task } from "../orchestrator/task.ts";
import type { AnyTool, Guardrail, ToolCallResult } from "../tools/types.ts";

/**
 * المخرج النهائي الموحد لكل وكيل. كل وكيل يوسّع الحقل data بمخطط خاص به.
 * - completed: انتهى العمل دون حاجة إلى إنسان.
 * - needs_approval: طلب إجراءً ينتظر موافقة بشرية.
 * - escalated: أحال الأمر إلى إنسان.
 * - rejected: رفض الطلب لسبب موثق، مثل مخالفة سياسة.
 */
export const OutcomeStatus = z.enum(["completed", "needs_approval", "escalated", "rejected"]);

export const HandoffSchema = z.object({
  taskType: z.string(),
  input: z.record(z.string(), z.any()),
  when: z.enum(["now", "after_approval"]),
});

export function outcomeSchema<D extends z.ZodType>(data: D) {
  return z.object({
    status: OutcomeStatus,
    summary: z.string().min(1).max(2000).describe("ملخص قصير للقرار وسببه، بلغة الطلب"),
    data,
    handoffs: z.array(HandoffSchema).default([]),
  });
}

export type AgentOutcome<D = unknown> = {
  status: z.infer<typeof OutcomeStatus>;
  summary: string;
  data: D;
  handoffs: Array<z.infer<typeof HandoffSchema>>;
};

/** واجهة الأدوات كما يراها منفّذ الوكيل (scripted أو live). */
export interface ToolGateway {
  call(name: string, input: Record<string, unknown>): Promise<ToolCallResult>;
}

/**
 * سياسة مرجعية حتمية: تنفيذ برمجي لقواعد القرار نفسها الموصوفة في system_prompt.md.
 * تُستخدم في وضع scripted لتشغيل evals بلا نموذج، وتمثل "المواصفة القابلة للتنفيذ" للوكيل.
 * في الوضع الحي يحل Claude محلها، ويُقاس بالمعايير نفسها.
 */
export type ReferencePolicy = (ctx: { task: Readonly<Task>; tools: ToolGateway }) => Promise<AgentOutcome>;

export interface AgentDefinition {
  id: string;
  domain: string;
  name: string;
  title: string;
  /** مؤشر الأداء الوحيد القابل للقياس الذي يُحاسب عليه الوكيل. */
  kpi: string;
  /** أنواع المهام التي يستلمها هذا الوكيل. */
  handles: string[];
  /** أنواع المهام التي يُسمح له بإحالتها لغيره. أي إحالة أخرى تُرفض. */
  canHandoffTo: string[];
  systemPrompt: string;
  tools: AnyTool[];
  guardrails: Guardrail[];
  memory: MemoryPolicy;
  outputSchema: z.ZodType<AgentOutcome>;
  defaultEscalationRole: HumanRole;
  /** حد أقصى لاستدعاءات الأدوات في المهمة الواحدة، للحماية من الحلقات. */
  maxToolCalls: number;
  referencePolicy: ReferencePolicy;
}

export function defineAgent(def: AgentDefinition): AgentDefinition {
  const names = new Set<string>();
  for (const t of def.tools) {
    if (names.has(t.name)) throw new Error(`Agent ${def.id}: duplicate tool ${t.name}`);
    names.add(t.name);
  }
  for (const g of def.guardrails)
    if (g.appliesTo !== "*")
      for (const t of g.appliesTo) if (!names.has(t)) throw new Error(`Guardrail ${g.id} targets unknown tool ${t}`);
  return def;
}

export function loadPrompt(url: URL): string {
  return readFileSync(url, "utf8");
}
