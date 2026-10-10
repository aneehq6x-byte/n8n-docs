import bcrypt from "bcryptjs";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "../audit";
import type { Database } from "../client";
import { passwordResetTokens, users } from "../schema";
import { generateToken, hashToken } from "../tokens";

const RESET_TTL_MS = 60 * 60 * 1000;

export const newPasswordSchema = z.string().min(8).max(200);

/**
 * Create a reset token if the account exists. Callers must respond identically
 * either way (no account enumeration); the token is only ever sent by email.
 */
export async function requestPasswordReset(db: Database, rawEmail: string, now: Date = new Date()) {
  const email = z.email().trim().toLowerCase().safeParse(rawEmail);
  if (!email.success) return null;
  const user = await db.query.users.findFirst({ where: eq(users.email, email.data) });
  if (!user) return null;
  const { token, hash } = generateToken();
  await db.transaction(async (tx) => {
    await tx.insert(passwordResetTokens).values({ userId: user.id, tokenHash: hash, expiresAt: new Date(now.getTime() + RESET_TTL_MS) });
    await writeAudit(tx, { orgId: null, actorUserId: user.id, action: "password.reset_requested" });
  });
  return { token, user: { id: user.id, email: user.email, name: user.name, locale: user.locale } };
}

export async function isResetTokenValid(db: Database, token: string, now: Date = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ id: passwordResetTokens.id })
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.tokenHash, hashToken(token)), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, now)))
    .limit(1);
  return Boolean(row);
}

/** Single-use: consumes the token and invalidates every other outstanding reset for the user. */
export async function resetPassword(db: Database, token: string, password: string, now: Date = new Date()): Promise<boolean> {
  const newPassword = newPasswordSchema.parse(password);
  const passwordHash = await bcrypt.hash(newPassword, 12);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.tokenHash, hashToken(token)), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, now)))
      .limit(1)
      .for("update");
    if (!row) return false;
    await tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId));
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokens.userId, row.userId), isNull(passwordResetTokens.usedAt)));
    await writeAudit(tx, { orgId: null, actorUserId: row.userId, action: "password.reset" });
    return true;
  });
}
