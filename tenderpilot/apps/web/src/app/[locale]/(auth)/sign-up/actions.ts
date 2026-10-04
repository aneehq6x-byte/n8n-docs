"use server";

import { createUser, EmailTakenError, getDb, signUpInputSchema } from "@tenderpilot/db";

export type SignUpResult =
  | { ok: true }
  | { ok: false; error: "invalidInput" | "emailTaken" | "genericError"; fields?: string[] };

export async function signUpAction(input: unknown): Promise<SignUpResult> {
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
