import "server-only";
import { redirect } from "next/navigation";
import { getSession } from "./session";

export class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(`${status}: ${detail}`);
  }
}

export function apiBase(): string {
  return (process.env.UMIP_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
}

function describe(body: unknown): string {
  if (body && typeof body === "object" && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      return d
        .map((x) => (typeof x === "string" ? x : (x as { msg?: string; loc?: unknown[] }).msg
          ? `${((x as { loc?: unknown[] }).loc ?? []).slice(1).join(".")}: ${(x as { msg: string }).msg}`
          : JSON.stringify(x)))
        .join(" · ");
    }
  }
  return "request failed";
}

/** Server-side call to the backend admin API with the session's key. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const session = await getSession();
  if (!session) redirect("/login");
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      ...init,
      cache: "no-store",
      headers: { "content-type": "application/json", ...init?.headers, "X-API-Key": session.key },
    });
  } catch {
    throw new ApiError(503, "backend unreachable");
  }
  if (res.status === 401) redirect("/login?expired=1");
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, describe(body));
  return body as T;
}

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** Wrap a mutation for use in a Server Action, converting API errors into a result. */
export async function mutate(path: string, method: string, body?: unknown): Promise<ActionResult> {
  try {
    await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: true };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: e.detail };
    throw e; // redirects and unexpected errors propagate
  }
}
