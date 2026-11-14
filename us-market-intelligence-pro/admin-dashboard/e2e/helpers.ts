import { expect, type Page } from "@playwright/test";

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export const KEYS = {
  admin: process.env.E2E_ADMIN_KEY ?? "demo-admin-key-0001",
  analyst: process.env.E2E_ANALYST_KEY ?? "demo-analyst-key-0002",
  support: process.env.E2E_SUPPORT_KEY ?? "demo-support-key-0003",
};

export async function login(page: Page, key: string, locale: "ar" | "en" = "ar") {
  await page.context().addCookies([{ name: "umip_locale", value: locale, url: BASE_URL }]);
  await page.goto("/login");
  await page.fill("#key", key);
  await page.locator("form:has(#key) button[type=submit]").click();
  await expect(page).toHaveURL(/\/$/);
}

/** Collects console errors and uncaught exceptions for the whole test. */
export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}
