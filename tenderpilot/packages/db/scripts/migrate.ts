import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { getServerEnv } from "@tenderpilot/config";
import { createDb } from "../src/client";
import { syncReferenceData } from "../src/reference-data";

const { db, close } = createDb(getServerEnv().DATABASE_URL, { max: 1 });
try {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  await syncReferenceData(db);
  console.log("✅ migrations applied, reference data synced");
} finally {
  await close();
}
