import { getServerEnv } from "@tenderpilot/config";
import { createDb } from "../src/client";
import { seedDemo } from "../src/seed";

const { db, close } = createDb(getServerEnv().DATABASE_URL, { max: 1 });
try {
  const result = await seedDemo(db);
  console.log("✅ seed complete");
  console.table(result);
} finally {
  await close();
}
