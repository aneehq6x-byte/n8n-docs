import { z } from "zod";

export const PLAN_IDS = ["trial", "starter", "professional", "enterprise"] as const;
export const planIdSchema = z.enum(PLAN_IDS);
export type PlanId = z.infer<typeof planIdSchema>;

/** Plans a customer can buy online (enterprise is sales-led). */
export const PURCHASABLE_PLANS = ["starter", "professional"] as const;
export const purchasablePlanSchema = z.enum(PURCHASABLE_PLANS);
export type PurchasablePlan = z.infer<typeof purchasablePlanSchema>;

export const BILLING_INTERVALS = ["monthly", "annual"] as const;
export const billingIntervalSchema = z.enum(BILLING_INTERVALS);
export type BillingInterval = z.infer<typeof billingIntervalSchema>;

export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "canceled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface PlanDefinition {
  id: PlanId;
  seats: number;
  /** Manual "Run Scout now" triggers per org per day (scheduled sweeps are unlimited). */
  scoutRunsPerDay: number;
  /** Monthly list price in halalas, excluding VAT. Null = not sold online. */
  monthlyPriceHalalas: number | null;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  trial: { id: "trial", seats: 3, scoutRunsPerDay: 5, monthlyPriceHalalas: null },
  starter: { id: "starter", seats: 3, scoutRunsPerDay: 10, monthlyPriceHalalas: 990_00 },
  professional: { id: "professional", seats: 10, scoutRunsPerDay: 50, monthlyPriceHalalas: 2_490_00 },
  enterprise: { id: "enterprise", seats: 50, scoutRunsPerDay: 500, monthlyPriceHalalas: null },
};

/** Saudi VAT (ZATCA) rate applied on top of list prices. */
export const VAT_RATE = 0.15;
/** Annual billing = 10 months' price (two months free). */
export const ANNUAL_MONTHS_CHARGED = 10;
/** Days a past-due subscription keeps working while payment is retried. */
export const PAST_DUE_GRACE_DAYS = 7;

export interface PriceQuote {
  plan: PurchasablePlan;
  interval: BillingInterval;
  subtotalHalalas: number;
  vatHalalas: number;
  totalHalalas: number;
}

/** Integer halala arithmetic only — no floating-point money. */
export function quote(plan: PurchasablePlan, interval: BillingInterval): PriceQuote {
  const monthly = PLANS[plan].monthlyPriceHalalas;
  if (monthly === null) throw new Error(`plan ${plan} is not sold online`);
  const subtotalHalalas = interval === "annual" ? monthly * ANNUAL_MONTHS_CHARGED : monthly;
  const vatHalalas = Math.round(subtotalHalalas * VAT_RATE);
  return { plan, interval, subtotalHalalas, vatHalalas, totalHalalas: subtotalHalalas + vatHalalas };
}

/** New period end after a successful payment: extends from the later of now and the current end. */
export function extendPeriod(currentEnd: Date, interval: BillingInterval, now: Date): Date {
  const base = new Date(Math.max(now.getTime(), currentEnd.getTime()));
  const next = new Date(base);
  if (interval === "annual") next.setUTCFullYear(next.getUTCFullYear() + 1);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

export interface SubscriptionSnapshot {
  plan: PlanId;
  status: SubscriptionStatus;
  seats: number;
  currentPeriodEnd: Date;
}

export interface Entitlements {
  plan: PlanId;
  status: SubscriptionStatus;
  /** Whether paid features (Scout runs, invitations) are available right now. */
  active: boolean;
  seats: number;
  scoutRunsPerDay: number;
  periodEnd: Date;
  /** Whole days left in the trial / paid period (0 once expired). */
  daysLeft: number;
  /** Trial within its last 3 days, or past-due in grace — show a banner. */
  warn: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pure access policy for an org's subscription. */
export function entitlementsFor(sub: SubscriptionSnapshot, now: Date): Entitlements {
  const plan = PLANS[sub.plan];
  const msLeft = sub.currentPeriodEnd.getTime() - now.getTime();
  const daysLeft = Math.max(0, Math.ceil(msLeft / DAY_MS));
  const inPeriod = msLeft > 0;
  const inGrace = sub.status === "past_due" && msLeft > -PAST_DUE_GRACE_DAYS * DAY_MS;
  const active = ((sub.status === "trialing" || sub.status === "active") && inPeriod) || inGrace;
  return {
    plan: sub.plan,
    status: sub.status,
    active,
    seats: sub.seats,
    scoutRunsPerDay: plan.scoutRunsPerDay,
    periodEnd: sub.currentPeriodEnd,
    daysLeft,
    warn: (sub.status === "trialing" && active && daysLeft <= 3) || inGrace,
  };
}
