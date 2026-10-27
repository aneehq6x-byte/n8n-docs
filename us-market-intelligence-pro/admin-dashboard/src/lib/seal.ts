/**
 * Session sealing with JWE (dir + A256GCM). Pure functions so they can be unit tested
 * without Next.js. The key is derived from SESSION_SECRET with SHA-256.
 */
import { EncryptJWT, jwtDecrypt } from "jose";
import { isRole, type Role } from "./roles";

export interface SessionPayload {
  key: string; // backend admin API key — never sent to the browser in clear
  role: Role;
  actor: string;
}

const ISSUER = "umip-admin";

async function deriveKey(secret: string): Promise<Uint8Array> {
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return new Uint8Array(digest);
}

export async function sealSession(p: SessionPayload, secret: string, ttlSeconds: number): Promise<string> {
  return new EncryptJWT({ k: p.key, r: p.role, a: p.actor })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${Math.floor(ttlSeconds)}s`)
    .encrypt(await deriveKey(secret));
}

export async function openSession(token: string | undefined, secret: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, await deriveKey(secret), { issuer: ISSUER });
    const { k, r, a } = payload as { k?: unknown; r?: unknown; a?: unknown };
    if (typeof k !== "string" || !isRole(r) || typeof a !== "string") return null;
    return { key: k, role: r, actor: a };
  } catch {
    return null; // tampered, expired or sealed with another secret
  }
}
