import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3200);
// The site origin metadata must use. It differs from baseURL (localhost) on purpose: Next's own fallback
// is localhost, so a missing or out-of-scope metadataBase can't pass by accident.
process.env.E2E_SITE_ORIGIN = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // E2E runs on `next dev` (production refuses fixture data); on-demand route compilation
  // times out under heavier parallelism.
  workers: process.env.CI ? 1 : 2,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "on-first-retry" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `bun run dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    // Fixture data + explicit dev auth bypass; never valid in production (next.config.ts guards).
    // BETTER_AUTH_URL gives metadata its own origin, as every deployment has (the bypass skips auth itself).
    // AI features stay off in e2e (an empty value overrides any AI_FEATURES_ENABLED in .env.local): no Claude calls.
    env: { DEV_AUTH_BYPASS: "1", MARKET_DATA_SOURCE: "fixture", FIXTURE_DATASET: "baseline", E2E_RATE_LIMIT_SCALE: "50", BETTER_AUTH_URL: process.env.E2E_SITE_ORIGIN, AI_FEATURES_ENABLED: "" },
  },
});
