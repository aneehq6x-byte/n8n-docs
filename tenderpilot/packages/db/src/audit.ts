import { and, desc, eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { auditLog } from "./schema";

export const AUDIT_ACTIONS = [
  "user.signed_up",
  "org.created",
  "company_profile.updated",
  "scout.triggered",
  "scout.completed",
  "opportunities.rescored",
  "opportunity.status_changed",
  "invitation.created",
  "invitation.revoked",
  "member.joined",
  "member.role_changed",
  "member.removed",
  "password.reset_requested",
  "password.reset",
  "billing.checkout_started",
  "billing.payment_succeeded",
  "billing.payment_failed",
  "tenders.imported",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  orgId: string | null;
  actorUserId: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/** Append-only audit trail. Call inside the same transaction as the change it records. */
export async function writeAudit(db: DbExecutor, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    orgId: entry.orgId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: entry.metadata ?? {},
  });
}

export async function latestAuditEvent(db: DbExecutor, orgId: string, action: AuditAction) {
  const [row] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.orgId, orgId), eq(auditLog.action, action)))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  return row ?? null;
}
