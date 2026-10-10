import type { AgentDefinition } from "../platform/agent/agent-definition.ts";
import { poIssuerAgent } from "./procurement/po-issuer/agent.ts";
import { requisitionIntakeAgent } from "./procurement/requisition-intake/agent.ts";

/** سجل كل وكلاء الأعمال المبنية. يُسجَّل في المنصة عند التشغيل: createPlatform().register(...ALL_AGENTS). */
export const ALL_AGENTS: AgentDefinition[] = [requisitionIntakeAgent, poIssuerAgent];
