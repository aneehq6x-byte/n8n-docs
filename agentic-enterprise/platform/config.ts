import { z } from "zod";

/**
 * إعدادات المنصة من متغيرات البيئة، مع تحقق صارم من الأنواع.
 * لا توجد قيم سرية افتراضية؛ المفتاح يُقرأ من البيئة فقط.
 */
const boolish = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const ConfigSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  AGENT_MODEL: z.string().default("claude-opus-5-5"),
  AGENT_RUNTIME: z.enum(["scripted", "live"]).default("scripted"),
  DATABASE_PATH: z.string().default("./data/enterprise.db"),
  KILL_SWITCH: boolish,
  KILL_SWITCH_FILE: z.string().default("./data/KILL_SWITCH"),
  APPROVAL_TTL_HOURS: z.coerce.number().positive().default(24),
  DUAL_APPROVAL_THRESHOLD_USD: z.coerce.number().positive().default(50_000),
  AGENT_MAX_TURNS: z.coerce.number().int().positive().default(20),
  AGENT_MAX_BUDGET_USD: z.coerce.number().positive().default(2),
});

export type PlatformConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<PlatformConfig> = {}): PlatformConfig {
  const parsed = ConfigSchema.parse(env);
  return { ...parsed, ...overrides };
}
