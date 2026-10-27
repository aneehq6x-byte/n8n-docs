"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { apiBase, mutate, type ActionResult } from "@/lib/api";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { THEME_COOKIE } from "@/lib/prefs";
import { isRole } from "@/lib/roles";
import { createSession, destroySession } from "@/lib/session";

const YEAR = 60 * 60 * 24 * 365;
const prefCookie = { path: "/", maxAge: YEAR, sameSite: "lax" as const, httpOnly: true };

function str(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
}

function invalid(e: z.ZodError): ActionResult {
  return { ok: false, error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join(" · ") };
}

/* ---------------------------------------------------------------- session */

export type LoginState = { error?: "invalid" | "unreachable" | "required" } | null;

export async function login(_: LoginState, fd: FormData): Promise<LoginState> {
  const key = str(fd, "key");
  if (!key) return { error: "required" };
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/admin/me`, { headers: { "X-API-Key": key }, cache: "no-store" });
  } catch {
    return { error: "unreachable" };
  }
  if (res.status === 401 || res.status === 403) return { error: "invalid" };
  if (!res.ok) return { error: "unreachable" };
  const me = (await res.json()) as { role?: unknown; actor?: unknown };
  if (!isRole(me.role) || typeof me.actor !== "string") return { error: "invalid" };
  await createSession({ key, role: me.role, actor: me.actor });
  redirect("/");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export async function setLocale(fd: FormData): Promise<void> {
  const v = str(fd, "locale");
  if (isLocale(v)) (await cookies()).set(LOCALE_COOKIE, v, prefCookie);
  revalidatePath("/", "layout");
}

export async function setTheme(fd: FormData): Promise<void> {
  const v = str(fd, "theme");
  const jar = await cookies();
  if (v === "light" || v === "dark") jar.set(THEME_COOKIE, v, prefCookie);
  else jar.delete(THEME_COOKIE);
  revalidatePath("/", "layout");
}

/* ---------------------------------------------------------------- signals */

const refSchema = z.string().regex(/^UM-\d{6}-[A-F0-9]{6}$/);

export async function decideSignal(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ref = refSchema.safeParse(str(fd, "ref"));
  if (!ref.success) return invalid(ref.error);
  const decision = str(fd, "decision");
  const body =
    decision === "reject"
      ? { approve: false, reason: str(fd, "reason") }
      : { approve: true, publish: decision === "approve_publish" };
  const r = await mutate(`/admin/signals/${ref.data}/decision`, "POST", body);
  revalidatePath("/signals", "layout");
  revalidatePath("/");
  return r;
}

const statusSchema = z.object({
  ref: refSchema,
  to: z.enum(["active", "target1_hit", "target2_hit", "stopped", "cancelled"]),
  r_net: z.union([z.literal(""), z.coerce.number().min(-20).max(50)]),
  note: z.string().max(500),
});

export async function updateSignalStatus(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const p = statusSchema.safeParse({ ref: str(fd, "ref"), to: str(fd, "to"), r_net: str(fd, "r_net"), note: str(fd, "note") });
  if (!p.success) return invalid(p.error);
  const { ref, to, r_net, note } = p.data;
  const r = await mutate(`/admin/signals/${ref}/status`, "POST", { to, note, r_net: r_net === "" ? null : r_net });
  revalidatePath(`/signals/${ref}`);
  revalidatePath("/performance");
  return r;
}

const manualSchema = z.object({
  symbol: z.string().regex(/^[A-Za-z.]{1,10}$/),
  direction: z.enum(["long", "short"]),
  entry_low: z.coerce.number().positive(),
  entry_high: z.coerce.number().positive(),
  stop: z.coerce.number().positive(),
  target1: z.coerce.number().positive(),
  target2: z.coerce.number().positive(),
  invalidation: z.string().min(3).max(300),
  reason: z.string().min(10).max(1000),
  valid_minutes: z.coerce.number().int().min(5).max(7200),
  score: z.coerce.number().min(0).max(100),
  kind: z.enum(["published", "paper"]),
});

export async function createManualSignal(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const p = manualSchema.safeParse(Object.fromEntries([...fd.entries()].filter(([k]) => !k.startsWith("$"))));
  if (!p.success) return invalid(p.error);
  const r = await mutate("/admin/signals", "POST", p.data);
  if (r.ok) {
    revalidatePath("/signals", "layout");
    redirect("/signals?tab=queue&created=1");
  }
  return r;
}

/* ------------------------------------------------------------------ users */

export async function blockUser(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = z.coerce.number().int().positive().safeParse(str(fd, "user_id"));
  if (!id.success) return invalid(id.error);
  const r = await mutate(`/admin/users/${id.data}/block`, "POST", { blocked: str(fd, "blocked") === "1", reason: str(fd, "reason") });
  revalidatePath(`/users/${id.data}`);
  revalidatePath("/users");
  return r;
}

export async function grantAccess(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = z.coerce.number().int().positive().safeParse(str(fd, "user_id"));
  if (!id.success) return invalid(id.error);
  const r = await mutate(`/admin/users/${id.data}/grant`, "POST", { plan_code: str(fd, "plan_code"), reason: str(fd, "reason") });
  revalidatePath(`/users/${id.data}`);
  return r;
}

/* --------------------------------------------------------------- payments */

export async function refundPayment(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = z.coerce.number().int().positive().safeParse(str(fd, "payment_id"));
  if (!id.success) return invalid(id.error);
  const r = await mutate(`/admin/payments/${id.data}/refund`, "POST", { reason: str(fd, "reason") });
  revalidatePath("/payments");
  revalidatePath("/");
  return r;
}

/* -------------------------------------------------------- plans & coupons */

const planSchema = z.object({
  code: z.string().regex(/^[a-z0-9_-]+$/),
  price_stars: z.union([z.literal(""), z.coerce.number().int().min(1).max(100000)]),
  name_ar: z.string().min(2).max(64),
  name_en: z.string().min(2).max(64),
  ai_daily_quota: z.coerce.number().int().min(0).max(1000),
  active: z.enum(["on", ""]),
});

export async function updatePlan(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const p = planSchema.safeParse({
    code: str(fd, "code"), price_stars: str(fd, "price_stars"), name_ar: str(fd, "name_ar"),
    name_en: str(fd, "name_en"), ai_daily_quota: str(fd, "ai_daily_quota"), active: str(fd, "active"),
  });
  if (!p.success) return invalid(p.error);
  const { code, price_stars, active, ...rest } = p.data;
  const r = await mutate(`/admin/plans/${code}`, "PATCH", {
    ...rest, active: active === "on", ...(price_stars === "" ? {} : { price_stars }),
  });
  revalidatePath("/plans");
  return r;
}

const couponSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{3,32}$/),
  percent_off: z.coerce.number().int().min(1).max(99),
  max_redemptions: z.union([z.literal(""), z.coerce.number().int().min(1)]),
  valid_until: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  plan_codes: z.array(z.string()),
});

export async function createCoupon(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const p = couponSchema.safeParse({
    code: str(fd, "code"), percent_off: str(fd, "percent_off"), max_redemptions: str(fd, "max_redemptions"),
    valid_until: str(fd, "valid_until"), plan_codes: fd.getAll("plan_codes").filter((v): v is string => typeof v === "string"),
  });
  if (!p.success) return invalid(p.error);
  const { max_redemptions, valid_until, plan_codes, ...rest } = p.data;
  const r = await mutate("/admin/coupons", "POST", {
    ...rest,
    max_redemptions: max_redemptions === "" ? null : max_redemptions,
    valid_until: valid_until === "" ? null : `${valid_until}T23:59:59+03:00`,
    plan_codes: plan_codes.length ? plan_codes : null,
  });
  revalidatePath("/plans");
  return r;
}

export async function toggleCoupon(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const code = str(fd, "code");
  const r = await mutate(`/admin/coupons/${encodeURIComponent(code)}`, "PATCH", { active: str(fd, "active") === "1" });
  revalidatePath("/plans");
  return r;
}

/* ----------------------------------------------------------------- system */

export async function setKillSwitch(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await mutate("/admin/kill-switch", "POST", { on: str(fd, "on") === "1" });
  revalidatePath("/", "layout");
  return r;
}

export async function setPublishMode(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const mode = z.enum(["human_approval", "automatic"]).safeParse(str(fd, "mode"));
  if (!mode.success) return invalid(mode.error);
  const r = await mutate("/admin/system/publish-mode", "POST", { mode: mode.data });
  revalidatePath("/", "layout");
  return r;
}

export async function toggleStrategy(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await mutate("/admin/system/strategies", "POST", { name: str(fd, "name"), disabled: str(fd, "disabled") === "1" });
  revalidatePath("/system");
  return r;
}

export async function retryDeadLetter(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = z.coerce.number().int().positive().safeParse(str(fd, "id"));
  if (!id.success) return invalid(id.error);
  const r = await mutate(`/admin/outbox/${id.data}/retry`, "POST");
  revalidatePath("/system");
  return r;
}
