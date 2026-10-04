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
