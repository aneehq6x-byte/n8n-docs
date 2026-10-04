import { relations } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { Permission, Role } from "@tenderpilot/core";
import { auditColumns } from "./columns";

/**
 * Phase 0 platform tables: tenancy, identity, access control, billing state and
 * the append-only audit trail. Every business table elsewhere hangs off `orgs`.
 */

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  /** Saudi Commercial Registration number (السجل التجاري). */
  crNumber: text("cr_number"),
  ...auditColumns,
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  locale: text("locale").$type<"ar" | "en">().notNull().default("ar"),
  ...auditColumns,
});

export const roles = pgTable("roles", {
  key: text("key").$type<Role>().primaryKey(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  permissions: jsonb("permissions").$type<Permission[]>().notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role")
      .$type<Role>()
      .notNull()
      .references(() => roles.key),
    ...auditColumns,
  },
  (t) => [unique("memberships_org_user_unique").on(t.orgId, t.userId), index("memberships_user_idx").on(t.userId)],
);

export const SUBSCRIPTION_PLANS = ["trial", "starter", "professional", "enterprise"] as const;
export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "canceled"] as const;

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .unique()
    .references(() => orgs.id, { onDelete: "cascade" }),
  plan: text("plan").$type<(typeof SUBSCRIPTION_PLANS)[number]>().notNull().default("trial"),
  status: text("status").$type<(typeof SUBSCRIPTION_STATUSES)[number]>().notNull().default("trialing"),
  seats: integer("seats").notNull().default(3),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
  ...auditColumns,
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_org_created_idx").on(t.orgId, t.createdAt)],
);

export const orgsRelations = relations(orgs, ({ many, one }) => ({
  memberships: many(memberships),
  subscription: one(subscriptions),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  org: one(orgs, { fields: [memberships.orgId], references: [orgs.id] }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  org: one(orgs, { fields: [subscriptions.orgId], references: [orgs.id] }),
}));
