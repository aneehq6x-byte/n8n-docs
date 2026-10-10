import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { BillingInterval, PurchasablePlan } from "@tenderpilot/core";
import { orgs, users } from "./platform";

export const CHECKOUT_STATUSES = ["pending", "paid", "failed", "expired"] as const;
export type CheckoutStatus = (typeof CHECKOUT_STATUSES)[number];

/**
 * One row per payment attempt. The amount we expect is frozen here at creation
 * and compared against what the gateway reports — never against client input.
 */
export const billingCheckouts = pgTable(
  "billing_checkouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    plan: text("plan").$type<PurchasablePlan>().notNull(),
    interval: text("interval").$type<BillingInterval>().notNull(),
    subtotalHalalas: integer("subtotal_halalas").notNull(),
    vatHalalas: integer("vat_halalas").notNull(),
    totalHalalas: integer("total_halalas").notNull(),
    currency: text("currency").$type<"SAR">().notNull().default("SAR"),
    provider: text("provider").notNull(),
    providerInvoiceId: text("provider_invoice_id").unique(),
    paymentUrl: text("payment_url"),
    status: text("status").$type<CheckoutStatus>().notNull().default("pending"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => [index("billing_checkouts_org_idx").on(t.orgId, t.createdAt)],
);
