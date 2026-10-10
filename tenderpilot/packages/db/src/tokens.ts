import { createHash, randomBytes } from "node:crypto";

/** A URL-safe secret (256 bits) plus the only thing we persist: its SHA-256. */
export function generateToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
