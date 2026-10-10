import "server-only";
import { headers } from "next/headers";
import { rateLimit } from "@tenderpilot/jobs";

/** First hop of X-Forwarded-For (set by the platform's proxy), else a stable placeholder. */
export function clientIpFrom(value: unknown): string {
  const first = typeof value === "string" ? value.split(",")[0]?.trim() : undefined;
  return first && first.length <= 64 ? first : "unknown";
}

export async function requestIp(): Promise<string> {
  const h = await headers();
  return clientIpFrom(h.get("x-forwarded-for") ?? h.get("x-real-ip"));
}

export const LIMITS = {
  /** Per account: slows password guessing against one user. */
  loginPerEmail: { limit: 5, windowSeconds: 15 * 60 },
  /** Per IP: slows credential stuffing across many users. */
  loginPerIp: { limit: 30, windowSeconds: 15 * 60 },
  resetPerEmail: { limit: 3, windowSeconds: 60 * 60 },
  resetPerIp: { limit: 10, windowSeconds: 60 * 60 },
  signupPerIp: { limit: 10, windowSeconds: 60 * 60 },
} as const;

/** True when every given limiter allows the attempt. */
export async function withinLimits(...checks: { key: string; limit: number; windowSeconds: number }[]): Promise<boolean> {
  const results = await Promise.all(checks.map((c) => rateLimit(c.key, c.limit, c.windowSeconds)));
  return results.every((r) => r.allowed);
}

/**
 * Only same-site relative paths survive as a post-login redirect target
 * (blocks open redirects like `//evil.com` or `/\evil.com`).
 */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/.test(value) && value.length <= 300 ? value : null;
}
