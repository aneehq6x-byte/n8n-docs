import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * غلاف رفيع حول node:sqlite المدمج في Node 22، فلا توجد اعتماديات أصلية (native) تحتاج بناء.
 * الوصول المتزامن من عدة عمليات مدعوم عبر WAL مع busy_timeout، وكل كتابة تقرأ ثم تعدّل تتم في transaction().
 * الانتقال إلى PostgreSQL مخطط (docs/architecture/TARGET_ARCHITECTURE.md)، والواجهات لا تتغير.
 */
export type Database = DatabaseSync;

export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // busy_timeout أولًا: تحويل الوضع إلى WAL يحتاج قفلًا، وبدون مهلة انتظار تفشل العملية الثانية فورًا (R2).
  db.exec("PRAGMA busy_timeout = 10000;");
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;");
  return db;
}

const depth = new WeakMap<Database, number>();

/**
 * تنفيذ مجموعة عمليات في معاملة واحدة: إما تنجح كلها أو لا يُحفظ شيء.
 * - المستوى الخارجي يستخدم BEGIN IMMEDIATE، فيأخذ قفل الكتابة فورًا ويُسلسل الكتّاب بين العمليات.
 * - المستويات الداخلية تستخدم SAVEPOINT، فيمكن استدعاء دالة تفتح معاملة من داخل معاملة أخرى.
 */
export function transaction<T>(db: Database, fn: () => T): T {
  const level = depth.get(db) ?? 0;
  const sp = `sp_${level}`;
  db.exec(level === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`);
  depth.set(db, level + 1);
  try {
    const result = fn();
    db.exec(level === 0 ? "COMMIT" : `RELEASE ${sp}`);
    return result;
  } catch (err) {
    db.exec(level === 0 ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw err;
  } finally {
    depth.set(db, level);
  }
}

/**
 * ترحيل إضافي آمن (additive): يضيف الأعمدة الناقصة فقط، ولا يحذف ولا يعدّل بيانات قائمة.
 * يتيح فتح قواعد أُنشئت بإصدار أقدم دون فقدان أي شيء.
 */
export function ensureColumns(db: Database, table: string, columns: Record<string, string>): string[] {
  const existing = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
  const added: string[] = [];
  for (const [name, type] of Object.entries(columns)) {
    if (existing.has(name)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    added.push(name);
  }
  return added;
}

export function parseJson<T>(text: unknown): T {
  return JSON.parse(String(text)) as T;
}
