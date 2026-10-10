import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * غلاف رفيع حول node:sqlite المدمج في Node 22، فلا توجد اعتماديات أصلية (native) تحتاج بناء.
 * في الإنتاج تُنقل الواجهات نفسها إلى PostgreSQL، وهذا مصنّف "مستقبلي" في docs/runbook.md.
 */
export type Database = DatabaseSync;

export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return db;
}

/** تنفيذ مجموعة عمليات في معاملة واحدة: إما تنجح كلها أو لا يُحفظ شيء. */
export function transaction<T>(db: Database, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function parseJson<T>(text: unknown): T {
  return JSON.parse(String(text)) as T;
}
