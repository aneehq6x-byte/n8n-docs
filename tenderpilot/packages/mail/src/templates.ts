import { ROLE_LABELS, type Role } from "@tenderpilot/core";
import type { MailMessage } from "./mailer";

/** Every interpolated value in HTML is escaped — org and person names are user input. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function layout(ar: string, en: string, actionUrl: string, ctaAr: string, ctaEn: string): string {
  const button = (label: string) =>
    `<a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#0f7a5f;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600">${label}</a>`;
  return `<!doctype html><html><body style="margin:0;background:#f4f7f6;font-family:Tahoma,'Segoe UI',Arial,sans-serif;color:#1d2a2a">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;padding:28px">
  <div dir="rtl" lang="ar" style="text-align:right;line-height:1.8">${ar}<p>${button(ctaAr)}</p></div>
  <hr style="border:none;border-top:1px solid #e3e9e7;margin:24px 0">
  <div dir="ltr" lang="en" style="text-align:left;line-height:1.6">${en}<p>${button(ctaEn)}</p></div>
  <p style="font-size:12px;color:#6b7a78;direction:ltr;text-align:left;word-break:break-all">${escapeHtml(actionUrl)}</p>
</div></body></html>`;
}

export function invitationEmail(input: {
  to: string;
  orgName: { ar: string; en: string };
  inviterName: string;
  role: Role;
  url: string;
  expiresAt: Date;
}): MailMessage {
  const org = { ar: escapeHtml(input.orgName.ar), en: escapeHtml(input.orgName.en) };
  const inviter = escapeHtml(input.inviterName);
  const role = ROLE_LABELS[input.role];
  const expires = input.expiresAt.toISOString().slice(0, 10);
  return {
    tag: "invitation",
    to: input.to,
    actionUrl: input.url,
    subject: `دعوة للانضمام إلى ${input.orgName.ar} على تندر بايلوت · Join ${input.orgName.en} on TenderPilot`,
    text: [
      `${input.inviterName} يدعوك للانضمام إلى ${input.orgName.ar} بدور «${role.ar}».`,
      `${input.inviterName} invited you to join ${input.orgName.en} as ${role.en}.`,
      input.url,
      `Expires ${expires}.`,
    ].join("\n\n"),
    html: layout(
      `<h2 style="margin:0 0 12px">دعوة للانضمام إلى ${org.ar}</h2><p>${inviter} يدعوك للانضمام إلى فريق <strong>${org.ar}</strong> على تندر بايلوت بدور <strong>${role.ar}</strong>.</p><p style="color:#6b7a78;font-size:13px">تنتهي صلاحية الدعوة في ${expires}.</p>`,
      `<h2 style="margin:0 0 12px">Join ${org.en}</h2><p>${inviter} invited you to join <strong>${org.en}</strong> on TenderPilot as <strong>${role.en}</strong>.</p><p style="color:#6b7a78;font-size:13px">This invitation expires on ${expires}.</p>`,
      input.url,
      "قبول الدعوة",
      "Accept invitation",
    ),
  };
}

export function passwordResetEmail(input: { to: string; name: string; url: string }): MailMessage {
  const name = escapeHtml(input.name);
  return {
    tag: "password_reset",
    to: input.to,
    actionUrl: input.url,
    subject: "إعادة تعيين كلمة المرور · Reset your TenderPilot password",
    text: [
      `مرحبًا ${input.name}، استخدم الرابط التالي لإعادة تعيين كلمة المرور خلال ساعة:`,
      `Hi ${input.name}, use this link to reset your password within one hour:`,
      input.url,
      "إن لم تطلب ذلك فتجاهل هذه الرسالة. · If you didn't ask for this, ignore this email.",
    ].join("\n\n"),
    html: layout(
      `<h2 style="margin:0 0 12px">إعادة تعيين كلمة المرور</h2><p>مرحبًا ${name}، طلبت إعادة تعيين كلمة المرور. الرابط صالح لمدة ساعة واحدة.</p><p style="color:#6b7a78;font-size:13px">إن لم تطلب ذلك فتجاهل هذه الرسالة؛ لن يتغير شيء.</p>`,
      `<h2 style="margin:0 0 12px">Reset your password</h2><p>Hi ${name}, we received a request to reset your password. The link is valid for one hour.</p><p style="color:#6b7a78;font-size:13px">If you didn't ask for this, ignore this email — nothing will change.</p>`,
      input.url,
      "تعيين كلمة مرور جديدة",
      "Set a new password",
    ),
  };
}
