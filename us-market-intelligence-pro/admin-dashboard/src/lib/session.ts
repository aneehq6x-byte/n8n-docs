import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { openSession, sealSession, type SessionPayload } from "./seal";

export const SESSION_COOKIE = "umip_session";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not configured");
  return s;
}

function ttlSeconds(): number {
  const h = Number(process.env.SESSION_TTL_HOURS ?? "8");
  return (Number.isFinite(h) && h > 0 ? Math.min(h, 24) : 8) * 3600;
}

export async function createSession(p: SessionPayload): Promise<void> {
  const ttl = ttlSeconds();
  const token = await sealSession(p, secret(), ttl);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ttl,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Memoised per request. */
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  return openSession((await cookies()).get(SESSION_COOKIE)?.value, secret());
});
