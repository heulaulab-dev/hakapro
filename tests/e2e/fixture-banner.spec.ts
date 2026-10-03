import { expect, test } from "@playwright/test";

// playwright.config.ts starts the dev server with MARKET_DATA_SOURCE=fixture and DEV_AUTH_BYPASS=1.
test("fixture mode shows a persistent FIXTURE DATA banner", async ({ page }) => {
  await page.goto("/");
  const banner = page.getByTestId("fixture-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("FIXTURE DATA");
  await expect(page.getByTestId("auth-bypass-banner")).toBeVisible();
  await page.mouse.wheel(0, 2000);
  await expect(banner).toBeInViewport();
});

test("fixture API responses are never LIVE or DELAYED", async ({ request }) => {
  for (const endpoint of ["/api/strategies", "/api/history/BBCA", "/api/broker-summary/BBCA", "/api/market-cap", "/api/search?q=bbca"]) {
    const body = await (await request.get(endpoint)).json();
    expect(["HISTORICAL", "UNAVAILABLE"], endpoint).toContain(body.freshness);
    expect(body.source, endpoint).toBe("fixture:arjum");
  }
});
