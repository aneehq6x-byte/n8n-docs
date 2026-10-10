/**
 * Phase-1 acceptance gate, driven through a real browser.
 *
 * Preconditions: fresh DB → `pnpm db:migrate && pnpm db:seed`, then `pnpm worker`
 * and the web app running. The demo tenant must have no tenders yet (the test
 * asserts the empty state, then runs the Scout from the UI).
 *
 *   cd e2e && npm install && BASE_URL=http://localhost:3000 node acceptance.mjs
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = new URL(".", import.meta.url).pathname + "screenshots/";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ check: name, ok: ok ? "PASS" : "FAIL", extra });
};

const exe = [process.env.CHROMIUM_PATH].find((p) => p && existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(`${m.text()} @ ${m.location().url} [on ${page.url()}]`));
page.on("pageerror", (e) => consoleErrors.push(e.message));
page.on("response", (r) => r.status() >= 400 && consoleErrors.push(`${r.status()} ${decodeURIComponent(r.url()).slice(0,140)}`));

// 1. Sign in (Arabic, default locale)
await page.goto(`${BASE}/`);
check("root redirects to /ar", page.url().includes("/ar/"), page.url());
await page.fill("#email", "demo@tenderpilot.sa");
await page.fill("#password", "Demo@12345");
await page.click("button[type=submit]");
await page.waitForURL(/\/ar\/dashboard/);
check("html dir=rtl lang=ar", (await page.getAttribute("html", "dir")) === "rtl" && (await page.getAttribute("html", "lang")) === "ar");

// 2. Empty state before any Scout run
const emptyVisible = await page.getByText("لا توجد فرص بعد").isVisible();
check("dashboard empty state (ar)", emptyVisible);
await page.screenshot({ path: OUT + "01-ar-dashboard-empty.png" });

// 3. Trigger the Scout from the UI → worker ingests → scoring worker scores → page refreshes
await page.getByRole("button", { name: "تشغيل المستكشف الآن" }).first().click();
await page.getByText("اكتمل الاستكشاف").first().waitFor({ timeout: 60_000 });
await page.getByText("الفرص المفتوحة", { exact: true }).waitFor({ timeout: 15_000 });
check("scout ran from UI and KPIs rendered", true);
const kpiOpen = await page.locator("section span.text-3xl").first().innerText();
check("open opportunities KPI > 0", Number(kpiOpen) > 0, `open=${kpiOpen}`);
await page.screenshot({ path: OUT + "02-ar-dashboard.png", fullPage: true });

// 4. Opportunities table (ar)
await page.goto(`${BASE}/ar/opportunities`);
await page.waitForLoadState("networkidle");
const rows = await page.locator("table tbody tr").count();
check("opportunities table shows all 12", rows === 12, `rows=${rows}`);
await page.screenshot({ path: OUT + "03-ar-opportunities.png", fullPage: true });

// filters: eligibility + search + sort
await page.getByLabel("الأهلية").selectOption("eligible");
await page.waitForURL(/eligibility=eligible/);
await page.waitForTimeout(500);
const eligibleRows = await page.locator("table tbody tr").count();
check("eligibility filter", eligibleRows === 8, `rows=${eligibleRows}`);
await page.getByLabel("بحث").fill("الرياض");
await page.waitForURL(/q=/);
await page.waitForTimeout(600);
const searchRows = await page.locator("table tbody tr").count();
check("arabic search narrows results", searchRows > 0 && searchRows < 8, `rows=${searchRows}`);
await page.goto(`${BASE}/ar/opportunities?sort=deadline&dir=asc`);
const firstDeadlineBadge = await page.locator("table tbody tr").first().innerText();
check("sort by deadline asc puts most urgent first", /يوم|يومان/.test(firstDeadlineBadge), firstDeadlineBadge.split("\n").slice(-2).join(" | "));
await page.goto(`${BASE}/ar/opportunities?q=zzzz-no-match`);
await page.waitForLoadState("networkidle");
check("filtered empty state", await page.getByRole("heading", { name: "لا توجد فرص مطابقة" }).first().isVisible());

// 5. Detail page with explainable breakdown (ar)
await page.goto(`${BASE}/ar/opportunities?sort=score&dir=desc`);
await page.locator("table tbody tr a").first().click();
await page.waitForURL(/\/ar\/opportunities\/[0-9a-f-]{36}/);
await page.locator('[role="meter"]').first().waitFor();
const meters = await page.locator('[role="meter"]').count();
check("detail shows 6 factor meters", meters === 6, `meters=${meters}`);
check("breakdown heading (ar)", await page.getByText("لماذا هذا التقييم").isVisible());
await page.screenshot({ path: OUT + "04-ar-detail.png", fullPage: true });

// status change (audited mutation)
await page.locator("#opportunity-status").selectOption("pursuing");
await page.getByText("تم تحديث الحالة").waitFor({ timeout: 10_000 });
check("status update persisted", true);

// 6. Switch to English on the same page
const detailPath = new URL(page.url()).pathname.replace(/^\/ar/, "");
await page.getByRole("button", { name: "English" }).click();
await page.waitForURL(new RegExp(`/en${detailPath}`));
await page.getByText("Why this score").waitFor();
check("locale switch keeps the page, dir=ltr", (await page.getAttribute("html", "dir")) === "ltr");
check("status survives reload", (await page.locator("#opportunity-status").inputValue()) === "pursuing");
await page.screenshot({ path: OUT + "05-en-detail.png", fullPage: true });

// disqualified detail (en)
await page.goto(`${BASE}/en/opportunities?eligibility=disqualified&sort=score&dir=desc`);
await page.locator("table tbody tr a").first().click();
await page.waitForURL(/\/en\/opportunities\/[0-9a-f-]{36}/);
await page.locator('[role="meter"]').first().waitFor();
check("disqualified banner + reason", await page.getByText("Ineligible:").isVisible());
await page.screenshot({ path: OUT + "06-en-detail-disqualified.png", fullPage: true });

await page.goto(`${BASE}/en/dashboard`);
await page.screenshot({ path: OUT + "07-en-dashboard.png", fullPage: true });
await page.goto(`${BASE}/en/opportunities`);
await page.screenshot({ path: OUT + "08-en-opportunities.png", fullPage: true });

// 6b. Company profile editor → save → instant re-score with impact (ar)
await page.goto(`${BASE}/ar/profile`);
await page.waitForLoadState("networkidle");
check("profile editor renders (ar)", await page.getByRole("heading", { name: "ملف الشركة" }).first().isVisible());
await page.screenshot({ path: OUT + "11-ar-profile.png", fullPage: true });
const certSelects = page.locator('select[id^="cert-type-"]');
const before = await certSelects.count();
await page.getByRole("button", { name: "إضافة شهادة" }).click();
await certSelects.nth(before).selectOption("sfda_license");
await page.locator('input[id^="cert-issuer-"]').nth(before).fill("الهيئة العامة للغذاء والدواء");
await page.locator('input[id^="cert-expires-"]').nth(before).fill("2030-01-01");
await page.getByRole("button", { name: "حفظ وإعادة التقييم" }).click();
await page.getByText(/تم الحفظ/).waitFor({ timeout: 15_000 });
check("profile save re-scores with impact", await page.getByText(/تحسّنت/).first().isVisible());
await page.screenshot({ path: OUT + "12-ar-profile-saved.png" });
// validation: duplicate certification is caught client-side
await page.getByRole("button", { name: "إضافة شهادة" }).click();
await certSelects.nth(before + 1).selectOption("sfda_license");
await page.getByRole("button", { name: "حفظ وإعادة التقييم" }).click();
check("duplicate certification rejected", await page.getByText("لا يمكن تكرار الشهادة نفسها.").isVisible());
// restore: remove both added rows and save (also exercises removal)
const removeCert = page.locator('div.rounded-lg.border:has(select[id^="cert-type-"]) button[aria-label="حذف"]');
await removeCert.nth(before + 1).click();
await removeCert.nth(before).click();
await page.getByRole("button", { name: "حفظ وإعادة التقييم" }).click();
await page.getByText(/تم الحفظ/).waitFor({ timeout: 15_000 });
check("profile restored", (await certSelects.count()) === before, `certs=${await certSelects.count()}`);

// 6c. Team: invite → email → sign up via link → accept → scoped permissions → reset password → rate limit
if (process.env.MAIL_OUTBOX_FILE) {
  const { readFileSync } = await import("node:fs");
  const lastMail = (to, tag) =>
    readFileSync(process.env.MAIL_OUTBOX_FILE, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((m) => m.to === to && m.tag === tag)
      .at(-1);
  const inviteeEmail = `analyst-${Date.now()}@tenderpilot.test`;

  await page.goto(`${BASE}/ar/team`);
  await page.waitForLoadState("networkidle");
  await page.fill("#invite-email", inviteeEmail);
  await page.locator("#invite-role").selectOption("analyst");
  await page.getByRole("button", { name: "إرسال الدعوة" }).click();
  await page.getByText(`تم إرسال الدعوة إلى ${inviteeEmail}`).waitFor({ timeout: 10_000 });
  const invite = lastMail(inviteeEmail, "invitation");
  check("invitation email sent (bilingual)", Boolean(invite?.actionUrl) && /دعوة/.test(invite.subject) && /Join/.test(invite.subject));
  await page.screenshot({ path: OUT + "13-ar-team.png", fullPage: true });

  const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const gp = await guest.newPage();
  gp.on("pageerror", (e) => consoleErrors.push(`guest: ${e.message}`));
  await gp.goto(invite.actionUrl.replace(/^https?:\/\/[^/]+/, BASE));
  await gp.getByRole("link", { name: "أنشئ حسابًا للقبول" }).click();
  await gp.waitForURL(/sign-up\?next=/);
  await gp.fill("#name", "خالد الحربي");
  await gp.fill("#email", inviteeEmail);
  await gp.fill("#password", "Analyst@12345");
  await gp.click("button[type=submit]");
  await gp.waitForURL(/\/ar\/invite\//);
  await gp.getByRole("button", { name: "قبول والانضمام" }).click();
  await gp.waitForURL(/\/ar\/dashboard/);
  check("invitee joined the inviting org", await gp.getByText("شركة البنيان المتقدمة للمقاولات").first().isVisible());
  await gp.goto(`${BASE}/ar/profile`);
  check("analyst sees profile read-only", await gp.getByText("يمكن للمالك والمدير فقط تعديل ملف الشركة.").isVisible());
  await guest.close();

  // forgot → emailed link → new password → sign in with it
  const anon2 = await browser.newContext();
  const rp = await anon2.newPage();
  await rp.goto(`${BASE}/ar/forgot-password`);
  await rp.fill("#email", inviteeEmail);
  await rp.getByRole("button", { name: "إرسال الرابط" }).click();
  await rp.getByText(/إذا كان هناك حساب/).waitFor();
  const reset = lastMail(inviteeEmail, "password_reset");
  check("reset email sent", Boolean(reset?.actionUrl));
  await rp.goto(reset.actionUrl.replace(/^https?:\/\/[^/]+/, BASE));
  await rp.fill("#password", "Changed@12345");
  await rp.getByRole("button", { name: "تحديث كلمة المرور" }).click();
  await rp.getByText("تم تحديث كلمة المرور").waitFor();
  await rp.goto(reset.actionUrl.replace(/^https?:\/\/[^/]+/, BASE));
  check("reset link is single-use", await rp.getByText("رابط إعادة التعيين غير صالح").isVisible());
  await rp.goto(`${BASE}/ar/sign-in`);
  await rp.fill("#email", inviteeEmail);
  await rp.fill("#password", "Changed@12345");
  await rp.click("button[type=submit]");
  await rp.waitForURL(/\/ar\/dashboard/);
  check("sign in with the new password", true);

  // brute force against one account is throttled
  const bp = await (await browser.newContext()).newPage();
  const victim = `nobody-${Date.now()}@tenderpilot.test`;
  let throttled = false;
  for (let i = 0; i < 7 && !throttled; i++) {
    await bp.goto(`${BASE}/ar/sign-in`);
    await bp.fill("#email", victim);
    await bp.fill("#password", "wrong-password");
    await bp.click("button[type=submit]");
    await bp.locator('form p[role="alert"]').waitFor();
    throttled = await bp.getByText("محاولات كثيرة").isVisible();
  }
  check("login rate limiting kicks in", throttled);

  // owner removes the analyst again (frees the seat for the next run)
  await page.goto(`${BASE}/ar/team`);
  await page.waitForLoadState("networkidle");
  const row = page.locator("li", { hasText: inviteeEmail });
  await row.getByRole("button", { name: "إزالة" }).click();
  await row.getByRole("button", { name: "تأكيد الإزالة" }).click();
  await row.waitFor({ state: "detached", timeout: 10_000 });
  check("owner removed the member", true);
}

// 6d. Billing: plan picker → hosted payment (fake Moyasar) → verified activation; forged callbacks rejected
if (process.env.FAKE_MOYASAR === "1") {
  await page.goto(`${BASE}/ar/billing`);
  await page.waitForLoadState("networkidle");
  check("billing page shows VAT-inclusive prices", await page.getByText(/ضريبة القيمة المضافة/).first().isVisible());
  check("charged amounts shown exact to the halala", await page.getByText(/2,863\.50/).first().isVisible());
  await page.screenshot({ path: OUT + "14-ar-billing.png", fullPage: true });
  await page.getByRole("button", { name: /اختيار خطة الاحترافية/ }).click();
  await page.waitForURL(/localhost:3200\/pay\//, { timeout: 15_000 });
  check("redirected to hosted payment for 2,863.50 SAR", await page.getByText("Pay 2863.50 SAR").isVisible());
  await page.getByRole("button", { name: "Pay now" }).click();
  await page.waitForURL(/\/ar\/billing\/return/, { timeout: 15_000 });
  check("payment verified server-side and plan activated", await page.getByText("تم استلام الدفعة").isVisible());
  await page.goto(`${BASE}/ar/billing`);
  check("plan is now Professional (active)", await page.getByText("الاحترافية").first().isVisible() && (await page.getByText("نشطة").first().isVisible()));
  check("payment appears in history as paid", await page.getByText("مدفوعة").first().isVisible());

  const forged = await page.request.post(`${BASE}/api/billing/moyasar`, { data: { id: "inv_forged", status: "paid", amount: 100 } });
  check("forged callback for unknown invoice rejected", forged.status() === 404, `status=${forged.status()}`);
  const junk = await page.request.post(`${BASE}/api/billing/moyasar`, { data: { id: "../../etc" } });
  check("malformed callback rejected", junk.status() === 400, `status=${junk.status()}`);
}

// 6e. CSV import: Arabic headers, per-cell errors, partial import → scored opportunities
{
  const stamp = Date.now();
  const csv = [
    "الرقم المرجعي,اسم المنافسة,الجهة,القطاع,آخر موعد لتقديم العروض,القيمة التقديرية,التصنيف المطلوب",
    `IMP-${stamp}-1,ترميم مستشفى الولادة في الدمام,وزارة الصحة,construction,15/12/2026,"22,000,000",المباني 3`,
    `IMP-${stamp}-2,صيانة طرق حي الملقا,أمانة منطقة الرياض,النقل والطرق,2026-12-20,9500000,roads:2`,
    `IMP-${stamp}-3,صف به أخطاء,جهة,space_mining,31/02/2027,abc,`,
  ].join("\n");
  await page.goto(`${BASE}/ar/import`);
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="file"]').setInputFiles({ name: "tenders.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await page.getByText("2 من 3 صفًا جاهزة للاستيراد").waitFor({ timeout: 10_000 });
  check("import preview validates rows", true);
  check("import reports per-cell errors", (await page.getByText("قطاع غير معروف").isVisible()) && (await page.getByText(/تاريخ غير صالح/).isVisible()));
  await page.screenshot({ path: OUT + "15-ar-import.png", fullPage: true });
  await page.getByRole("button", { name: "استيراد منافستين" }).click();
  await page.getByText(/تم الاستيراد: 2 جديدة/).waitFor({ timeout: 15_000 });
  check("valid rows imported and scored", true);
  await page.goto(`${BASE}/ar/opportunities?q=${encodeURIComponent("ترميم مستشفى الولادة")}`);
  await page.waitForLoadState("networkidle");
  check("imported tender appears as a scored opportunity", (await page.locator("table tbody tr").count()) === 1);
}

// 7. Dark mode + mobile RTL
const dark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark", storageState: await ctx.storageState() });
const dp = await dark.newPage();
await dp.goto(`${BASE}/ar/dashboard`);
check("dark theme applied", (await dp.getAttribute("html", "class"))?.includes("dark") ?? false);
await dp.screenshot({ path: OUT + "09-ar-dashboard-dark.png", fullPage: true });

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, storageState: await ctx.storageState() });
const mp = await mobile.newPage();
await mp.goto(`${BASE}/ar/opportunities`);
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("mobile: no horizontal page scroll", overflow <= 0, `overflow=${overflow}px`);
await mp.screenshot({ path: OUT + "10-ar-mobile-opportunities.png", fullPage: true });

// 8. Tenant isolation / auth guard via API
const anon = await browser.newContext();
const ap = await anon.newPage();
const res = await ap.request.get(`${BASE}/api/trpc/opportunities.list?input=${encodeURIComponent(JSON.stringify({ json: {} }))}`);
check("API rejects unauthenticated list", res.status() === 401, `status=${res.status()}`);

check("no browser console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" || "));
console.table(results);
await browser.close();
process.exit(results.some((r) => r.ok === "FAIL") ? 1 : 0);
