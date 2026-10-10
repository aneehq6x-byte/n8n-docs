"use server";

import { getLocale } from "next-intl/server";
import { appUrl } from "@tenderpilot/config";
import { getDb, isResetTokenValid, requestPasswordReset, resetPassword } from "@tenderpilot/db";
import { getMailer, passwordResetEmail } from "@tenderpilot/mail";
import { LIMITS, requestIp, withinLimits } from "@/server/security";

export interface ForgotState {
  status: "idle" | "sent" | "rateLimited";
}

/**
 * Always answers "sent" for well-formed requests, whether or not the account
 * exists, so the endpoint can't be used to discover registered emails.
 */
export async function forgotPasswordAction(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const ip = await requestIp();
  const allowed = await withinLimits(
    { key: `reset:ip:${ip}`, ...LIMITS.resetPerIp },
    { key: `reset:email:${email}`, ...LIMITS.resetPerEmail },
  );
  if (!allowed) return { status: "rateLimited" };

  const locale = await getLocale();
  try {
    const result = await requestPasswordReset(getDb(), email);
    if (result) {
      const mailLocale = result.user.locale === "en" ? "en" : locale;
      await getMailer().send(
        passwordResetEmail({ to: result.user.email, name: result.user.name, url: `${appUrl()}/${mailLocale}/reset-password/${result.token}` }),
      );
    }
  } catch (err) {
    // Log, but never reveal the failure mode to the requester.
    console.error("password reset request failed", err);
  }
  return { status: "sent" };
}

export interface ResetState {
  status: "idle" | "done" | "invalid" | "weak";
}

export async function resetPasswordAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password.length < 8 || password.length > 200) return { status: "weak" };
  const ok = await resetPassword(getDb(), token, password);
  return { status: ok ? "done" : "invalid" };
}

export async function checkResetToken(token: string): Promise<boolean> {
  return isResetTokenValid(getDb(), token);
}
