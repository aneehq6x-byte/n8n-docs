import { PlatformError } from "../../platform/core/errors.ts";
import type { Platform } from "../../platform/index.ts";

/**
 * قرار بشري على تطابق محتمل. لا توجد أداة وكيل تستدعي هذه الدالة.
 * تُستدعى من واجهة مسؤول الامتثال، ومن evals لمحاكاته.
 * تتحقق من الدور، وتسجل القرار في audit log، وتغلق التصعيدات المفتوحة على المهمة.
 */
export function resolvePotentialMatch(p: Platform, screeningId: string, humanId: string, status: "false_positive" | "confirmed_match", note: string) {
  const human = p.directory.get(humanId);
  if (!human.roles.includes("compliance_officer")) {
    p.audit.append({ actor: { type: "human", id: humanId }, action: "compliance.resolve_match", target: screeningId, outcome: "denied", data: { reason: "not a compliance officer" } });
    throw new PlatformError("UNAUTHORIZED_APPROVER", "Only a compliance officer can resolve a potential sanctions match");
  }
  const rec = p.connectors.sanctions.resolveScreening(screeningId, humanId, status, note);
  p.audit.append({ actor: { type: "human", id: humanId }, action: "compliance.resolve_match", target: screeningId, taskId: rec.sourceTaskId, outcome: "success", data: { status, note, partyId: rec.partyId } });
  return rec;
}
