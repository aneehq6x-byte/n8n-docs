"use server";

import { createUser, EmailTakenError, getDb, signUpInputSchema } from "@tenderpilot/db";
import { LIMITS, requestIp, withinLimits } from "@/server/security";

export type SignUpResult =
  | { ok: true }
  | { ok: false; error: "invalidInput" | "emailTaken" | "genericError" | "rateLimited"; fields?: string[] };

export async function signUpAction(input: unknown): Promise<SignUpResult> {
  if (!(await withinLimits({ key: `signup:ip:${await requestIp()}`, ...LIMITS.signupPerIp }))) {
    return { ok: false, error: "rateLimited" };
  }
  const parsed = signUpInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalidInput", fields: parsed.error.issues.map((i) => String(i.path[0])) };
  }
  try {
    await createUser(getDb(), parsed.data);
    return { ok: true };
  } catch (err) {
    if (err instanceof EmailTakenError) return { ok: false, error: "emailTaken" };
    console.error("sign-up failed", err);
    return { ok: false, error: "genericError" };
  }
}
