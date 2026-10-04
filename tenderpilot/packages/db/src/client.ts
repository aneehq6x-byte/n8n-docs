import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getServerEnv } from "@tenderpilot/config";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
/** Either the root db or a transaction handle — services accept both. */
export type DbExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DbHandle {
  db: Database;
  close: () => Promise<void>;
}

export function createDb(url: string, opts: { max?: number } = {}): DbHandle {
  const client = postgres(url, { max: opts.max ?? 10, onnotice: () => undefined });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

// Survive Next.js dev hot-reloads without leaking connection pools.
const globalForDb = globalThis as typeof globalThis & { __tenderpilotDb?: DbHandle };

/** Process-wide pooled connection, created lazily from validated env. */
export function getDb(): Database {
  globalForDb.__tenderpilotDb ??= createDb(getServerEnv().DATABASE_URL);
  return globalForDb.__tenderpilotDb.db;
}

export async function closeDb(): Promise<void> {
  await globalForDb.__tenderpilotDb?.close();
  globalForDb.__tenderpilotDb = undefined;
}
