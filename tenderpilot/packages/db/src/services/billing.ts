import { and, desc, eq, inArray } from "drizzle-orm";
import {
  PLANS,
  entitlementsFor,
  extendPeriod,
  quote,
  type BillingInterval,
  type Entitlements,
  type PurchasablePlan,
} from "@tenderpilot/core";
import { writeAudit } from "../audit";
import type { Database, DbExecutor } from "../client";
import { billingCheckouts, subscriptions, type CheckoutStatus } from "../schema";

/** What any payment gateway must offer. Implemented by @tenderpilot/payments. */
export interface GatewayInvoice {
  id: string;
  status: string;
  /** Minor units (halalas). */
  amount: number;
  currency: string;
  url: string | null;
  metadata: Record<string, string>;
}

export interface PaymentGateway {
  readonly name: string;
  createInvoice(input: {
    amountHalalas: number;
    currency: "SAR";
    description: string;
    successUrl: string;
    backUrl: string;
    callbackUrl: string;
    metadata: Record<string, string>;
  }): Promise<GatewayInvoice>;
  fetchInvoice(id: string): Promise<GatewayInvoice>;
}

export async function getOrgEntitlements(db: DbExecutor, orgId: string, now: Date = new Date()): Promise<Entitlements> {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId)).limit(1);
  if (!sub) {
    // Defensive: an org without a subscription row gets an expired trial, never free access.
    return entitlementsFor({ plan: "trial", status: "canceled", seats: 1, currentPeriodEnd: new Date(0) }, now);
  }
  return entitlementsFor({ plan: sub.plan, status: sub.status, seats: sub.seats, currentPeriodEnd: sub.currentPeriodEnd }, now);
}

/** Orgs whose subscription currently allows scheduled Scout sweeps. */
export async function listActiveOrgIds(db: DbExecutor, now: Date = new Date()): Promise<string[]> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(inArray(subscriptions.status, ["trialing", "active", "past_due"]));
  return rows
    .filter((s) => entitlementsFor({ plan: s.plan, status: s.status, seats: s.seats, currentPeriodEnd: s.currentPeriodEnd }, now).active)
    .map((s) => s.orgId);
}

export interface StartCheckoutInput {
  orgId: string;
  plan: PurchasablePlan;
  interval: BillingInterval;
  actorUserId: string;
  /** Builds the return/callback URLs once the checkout id is known. */
  urls: (checkoutId: string) => { successUrl: string; backUrl: string; callbackUrl: string };
  description: string;
}

export async function startCheckout(db: Database, gateway: PaymentGateway, input: StartCheckoutInput) {
  const price = quote(input.plan, input.interval);
  const [checkout] = await db
    .insert(billingCheckouts)
    .values({
      orgId: input.orgId,
      plan: input.plan,
      interval: input.interval,
      subtotalHalalas: price.subtotalHalalas,
      vatHalalas: price.vatHalalas,
      totalHalalas: price.totalHalalas,
      provider: gateway.name,
      createdByUserId: input.actorUserId,
    })
    .returning();
  if (!checkout) throw new Error("checkout insert failed");

  let invoice: GatewayInvoice;
  try {
    invoice = await gateway.createInvoice({
      amountHalalas: price.totalHalalas,
      currency: "SAR",
      description: input.description,
      metadata: { checkout_id: checkout.id, org_id: input.orgId, plan: input.plan, interval: input.interval },
      ...input.urls(checkout.id),
    });
  } catch (err) {
    await db.update(billingCheckouts).set({ status: "failed" }).where(eq(billingCheckouts.id, checkout.id));
    throw err;
  }
  if (!invoice.url) throw new Error("gateway returned no payment URL");

  await db.transaction(async (tx) => {
    await tx
      .update(billingCheckouts)
      .set({ providerInvoiceId: invoice.id, paymentUrl: invoice.url })
      .where(eq(billingCheckouts.id, checkout.id));
    await writeAudit(tx, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      action: "billing.checkout_started",
      targetType: "billing_checkout",
      targetId: checkout.id,
      metadata: { plan: input.plan, interval: input.interval, totalHalalas: price.totalHalalas },
    });
  });
  return { checkoutId: checkout.id, paymentUrl: invoice.url };
}

export type ConfirmOutcome = { status: CheckoutStatus; activated: boolean; reason?: string };

const FAILED_STATES = new Set(["failed", "canceled", "voided"]);

/**
 * Settle a checkout by asking the gateway — never by trusting a redirect or a
 * webhook body. Verifies invoice id, amount, currency and our checkout id in the
 * metadata, then activates the subscription exactly once (idempotent).
 */
export async function confirmCheckout(
  db: Database,
  gateway: PaymentGateway,
  lookup: { checkoutId: string } | { providerInvoiceId: string },
  now: Date = new Date(),
): Promise<ConfirmOutcome | null> {
  const where =
    "checkoutId" in lookup ? eq(billingCheckouts.id, lookup.checkoutId) : eq(billingCheckouts.providerInvoiceId, lookup.providerInvoiceId);
  const [checkout] = await db.select().from(billingCheckouts).where(where).limit(1);
  if (!checkout) return null;
  if (checkout.status === "paid") return { status: "paid", activated: false };
  if (!checkout.providerInvoiceId) return { status: checkout.status, activated: false, reason: "no_invoice" };

  const invoice = await gateway.fetchInvoice(checkout.providerInvoiceId);
  const mismatch =
    invoice.id !== checkout.providerInvoiceId
      ? "invoice_id"
      : invoice.amount !== checkout.totalHalalas
        ? "amount"
        : invoice.currency.toUpperCase() !== checkout.currency
          ? "currency"
          : invoice.metadata.checkout_id !== undefined && invoice.metadata.checkout_id !== checkout.id
            ? "metadata"
            : null;
  if (mismatch) {
    await writeAudit(db, {
      orgId: checkout.orgId,
      actorUserId: null,
      action: "billing.payment_failed",
      targetType: "billing_checkout",
      targetId: checkout.id,
      metadata: { reason: `mismatch:${mismatch}`, invoiceStatus: invoice.status },
    });
    return { status: checkout.status, activated: false, reason: `mismatch:${mismatch}` };
  }

  if (invoice.status === "paid") {
    return db.transaction(async (tx) => {
      // The status guard makes concurrent confirmations (redirect + webhook) activate once.
      const [claimed] = await tx
        .update(billingCheckouts)
        .set({ status: "paid", paidAt: now })
        .where(and(eq(billingCheckouts.id, checkout.id), eq(billingCheckouts.status, "pending")))
        .returning({ id: billingCheckouts.id });
      if (!claimed) return { status: "paid" as const, activated: false };

      const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.orgId, checkout.orgId)).limit(1).for("update");
      const currentEnd = sub?.status === "active" && sub.plan === checkout.plan ? sub.currentPeriodEnd : now;
      const values = {
        plan: checkout.plan,
        status: "active" as const,
        billingInterval: checkout.interval,
        seats: PLANS[checkout.plan].seats,
        currentPeriodEnd: extendPeriod(currentEnd, checkout.interval, now),
      };
      if (sub) await tx.update(subscriptions).set(values).where(eq(subscriptions.orgId, checkout.orgId));
      else await tx.insert(subscriptions).values({ orgId: checkout.orgId, ...values });

      await writeAudit(tx, {
        orgId: checkout.orgId,
        actorUserId: checkout.createdByUserId,
        action: "billing.payment_succeeded",
        targetType: "billing_checkout",
        targetId: checkout.id,
        metadata: { plan: checkout.plan, interval: checkout.interval, totalHalalas: checkout.totalHalalas, invoiceId: invoice.id },
      });
      return { status: "paid" as const, activated: true };
    });
  }

  if (FAILED_STATES.has(invoice.status) || invoice.status === "expired") {
    const status: CheckoutStatus = invoice.status === "expired" ? "expired" : "failed";
    await db
      .update(billingCheckouts)
      .set({ status })
      .where(and(eq(billingCheckouts.id, checkout.id), eq(billingCheckouts.status, "pending")));
    return { status, activated: false };
  }
  return { status: "pending", activated: false };
}

export async function listCheckouts(db: Database, orgId: string, limit = 10) {
  return db
    .select({
      id: billingCheckouts.id,
      plan: billingCheckouts.plan,
      interval: billingCheckouts.interval,
      totalHalalas: billingCheckouts.totalHalalas,
      vatHalalas: billingCheckouts.vatHalalas,
      status: billingCheckouts.status,
      createdAt: billingCheckouts.createdAt,
      paidAt: billingCheckouts.paidAt,
    })
    .from(billingCheckouts)
    .where(eq(billingCheckouts.orgId, orgId))
    .orderBy(desc(billingCheckouts.createdAt))
    .limit(limit);
}

/** For the return page: only an org's own checkout is visible. */
export async function getCheckoutForOrg(db: Database, orgId: string, checkoutId: string) {
  const [row] = await db
    .select()
    .from(billingCheckouts)
    .where(and(eq(billingCheckouts.id, checkoutId), eq(billingCheckouts.orgId, orgId)))
    .limit(1);
  return row ?? null;
}
