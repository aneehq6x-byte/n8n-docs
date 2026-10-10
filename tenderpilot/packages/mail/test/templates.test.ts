import { describe, expect, it } from "vitest";
import { escapeHtml, invitationEmail, passwordResetEmail } from "../src";

describe("mail templates", () => {
  it("escapes user-controlled values in HTML", () => {
    const mail = invitationEmail({
      to: "a@b.sa",
      orgName: { ar: "شركة <script>", en: 'Evil "Co" <img src=x onerror=alert(1)>' },
      inviterName: "<b>Mallory</b>",
      role: "analyst",
      url: "https://app.tenderpilot.sa/ar/invite/abc",
      expiresAt: new Date("2026-10-20T00:00:00Z"),
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain("<b>Mallory</b>");
    expect(mail.html).toContain("&lt;b&gt;Mallory&lt;/b&gt;");
  });

  it("is bilingual, Arabic first and RTL", () => {
    const mail = passwordResetEmail({ to: "a@b.sa", name: "سارة", url: "https://x/ar/reset-password/t" });
    expect(mail.html.indexOf('dir="rtl"')).toBeLessThan(mail.html.indexOf('dir="ltr"'));
    expect(mail.subject).toMatch(/إعادة تعيين/);
    expect(mail.subject).toMatch(/Reset/);
    expect(mail.text).toContain("https://x/ar/reset-password/t");
    expect(mail.actionUrl).toBe("https://x/ar/reset-password/t");
  });

  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
