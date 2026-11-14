import { expect, test } from "@playwright/test";
import { KEYS, login, trackErrors } from "./helpers";

const SHOTS = "e2e/.output/screens";

test.describe("authentication", () => {
  test("unauthenticated visitors are sent to login", async ({ page }) => {
    await page.goto("/signals");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("an invalid key is rejected without creating a session", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#key", "not-a-real-key");
    await page.locator("form:has(#key) button[type=submit]").click();
    await expect(page.getByRole("alert").filter({ hasText: "المفتاح غير صالح" })).toBeVisible();
    expect((await page.context().cookies()).find((c) => c.name === "umip_session")).toBeUndefined();
  });

  test("the session cookie is httpOnly, strict and does not contain the key", async ({ page }) => {
    await login(page, KEYS.admin);
    const cookie = (await page.context().cookies()).find((c) => c.name === "umip_session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Strict");
    expect(cookie?.value).not.toContain(KEYS.admin);
    expect(await page.evaluate(() => document.cookie)).not.toContain("umip_session");
  });

  test("sign out clears the session", async ({ page }) => {
    await login(page, KEYS.admin);
    await page.getByRole("button", { name: "تسجيل الخروج" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("role-based access", () => {
  test("support cannot see or open admin-only pages", async ({ page }) => {
    await login(page, KEYS.support);
    const nav = page.getByRole("navigation", { name: "main" });
    await expect(nav.getByRole("link", { name: "المدفوعات" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /الإشارات/ })).toHaveCount(0);
    await page.goto("/payments");
    await expect(page).toHaveURL(/forbidden=1/);
    await expect(page.getByText("صلاحياتك لا تسمح بهذا الإجراء.")).toBeVisible();
  });

  test("analyst sees signals but not plans", async ({ page }) => {
    await login(page, KEYS.analyst);
    const nav = page.getByRole("navigation", { name: "main" });
    await expect(nav.getByRole("link", { name: /الإشارات/ })).toBeVisible();
    await expect(nav.getByRole("link", { name: "الخطط والكوبونات" })).toHaveCount(0);
  });
});

test("every page renders without errors (admin, Arabic)", async ({ page }) => {
  const errors = trackErrors(page);
  await login(page, KEYS.admin);
  await page.goto("/users");
  const userHref = await page.locator("tbody a").first().getAttribute("href");
  const paths = ["/", "/signals?tab=queue", "/signals?tab=closed", "/signals/new", "/users", userHref!, "/payments",
    "/plans", "/performance", "/performance?kind=paper", "/system", "/audit"];
  for (const p of paths) {
    const res = await page.goto(p);
    expect(res?.status(), p).toBe(200);
    await expect(page.locator("main h1").first(), p).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("signal workflow: manual paper signal → approve → track → close", async ({ page }) => {
  const errors = trackErrors(page);
  await login(page, KEYS.analyst);
  await page.goto("/signals/new");
  await page.fill("#symbol", "msft");
  await page.selectOption("#kind", "paper");
  await page.fill("#entry_low", "420");
  await page.fill("#entry_high", "420.5");
  await page.fill("#stop", "417");
  await page.fill("#target1", "426");
  await page.fill("#target2", "431");
  await expect(page.getByText("1:1.77")).toBeVisible(); // live reward/risk preview: (426-420.25)/(420.25-417)
  await page.fill("#invalidation", "5m close below 418.5");
  await page.fill("#reason", "Reclaim of session VWAP with improving breadth (E2E)");
  await page.getByRole("button", { name: "إنشاء الإشارة" }).click();
  await expect(page).toHaveURL(/tab=queue&created=1/);

  await page.locator("tbody tr", { hasText: "MSFT" }).first().locator("a").click();
  await expect(page.getByText("بانتظار المراجعة").first()).toBeVisible();
  await page.getByRole("button", { name: "اعتماد ونشر" }).click();
  await expect(page.locator("#to")).toBeVisible();

  await page.selectOption("#to", "active");
  await page.getByRole("button", { name: "حفظ" }).click();
  await expect(page.locator("#to")).toHaveValue("target1_hit");

  await page.selectOption("#to", "stopped");
  await page.getByRole("button", { name: "حفظ" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "r_net" })).toBeVisible(); // closing needs the net result

  await page.fill("#r_net", "-1.05");
  await page.selectOption("#to", "stopped");
  await page.getByRole("button", { name: "حفظ" }).click();
  await expect(page.getByText("الإشارة في حالة نهائية")).toBeVisible();
  await expect(page.getByText("-1.05R")).toBeVisible();
  expect(errors).toEqual([]);
});

test("kill switch requires a typed confirmation and can be reversed", async ({ page }) => {
  await login(page, KEYS.admin);
  await page.goto("/system");
  await page.getByRole("button", { name: "تفعيل الإيقاف" }).click();
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "تأكيد" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("اكتب STOP للتأكيد").fill("STOP");
  await confirm.click();
  await expect(page.locator("header").getByText("مفتاح الإيقاف الطارئ")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/system-kill-on.png`, fullPage: true });

  await page.getByRole("button", { name: "إلغاء الإيقاف" }).click();
  await page.getByRole("dialog").getByLabel("اكتب RESUME للتأكيد").fill("RESUME");
  await page.getByRole("dialog").getByRole("button", { name: "تأكيد" }).click();
  await expect(page.locator("header").getByText("مفتاح الإيقاف الطارئ")).toHaveCount(0);
});

test("language and theme switches persist", async ({ page }) => {
  await login(page, KEYS.admin);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "System" }).click();
  await page.getByRole("button", { name: "العربية" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("screenshots for visual review", async ({ browser }) => {
  const variants = [["ar", "light", 1440, 1000], ["en", "dark", 1440, 1000], ["ar", "light", 390, 844]] as const;
  for (const [locale, scheme, w, h] of variants) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
    const page = await ctx.newPage();
    await login(page, KEYS.admin, locale);
    for (const [name, path] of [["overview", "/"], ["signals", "/signals?tab=all"], ["performance", "/performance?kind=paper"], ["users", "/users"], ["system", "/system"]] as const) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${SHOTS}/${name}-${locale}-${scheme}-${w}.png`, fullPage: true });
    }
    await ctx.close();
  }
});
