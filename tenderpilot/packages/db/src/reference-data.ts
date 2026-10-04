import { sql } from "drizzle-orm";
import { ROLES, ROLE_LABELS, ROLE_PERMISSIONS } from "@tenderpilot/core";
import type { DbExecutor } from "./client";
import { roles } from "./schema";

/** Idempotently sync code-defined reference data (roles) into the database. */
export async function syncReferenceData(db: DbExecutor): Promise<void> {
  await db
    .insert(roles)
    .values(
      ROLES.map((key) => ({
        key,
        nameAr: ROLE_LABELS[key].ar,
        nameEn: ROLE_LABELS[key].en,
        permissions: [...ROLE_PERMISSIONS[key]],
      })),
    )
    .onConflictDoUpdate({
      target: roles.key,
      set: {
        nameAr: sql`excluded.name_ar`,
        nameEn: sql`excluded.name_en`,
        permissions: sql`excluded.permissions`,
      },
    });
}
