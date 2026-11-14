import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against a running backend (seeded with scripts/seed_demo.py) and dashboard.
 * PW_CHROMIUM lets environments with a preinstalled browser point at it.
 */
export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/.output/results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
});
