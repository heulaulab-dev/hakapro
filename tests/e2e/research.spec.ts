import { expect, test } from "@playwright/test";

test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== "desktop", "desktop only"));

test.describe("research brief", () => {
  test("BBCA brief renders every section with its as-of stamp and data quality (fixture data)", async ({ page }) => {
    await page.goto("/id/research/BBCA");
    const view = page.getByTestId("research-view");
    // Same price and change as the stock page header for the baseline session.
    await expect(view.getByTestId("research-header")).toContainText("Rp6.300");
    await expect(view.getByTestId("research-header")).toContainText("-0,79%");
    await expect(view.getByTestId("research-asof")).toContainText("Data per 18 Sep 2026");
    await expect(view.getByTestId("research-freshness")).toHaveAttribute("data-freshness", "stale");
    await expect(view.getByTestId("research-summary")).toContainText("Belum ada skor");
    await expect(view.getByTestId("research-flow").getByTestId("flow-row-30D")).toBeVisible();
    await expect(view.getByTestId("research-counter")).toBeVisible();
    await expect(view.getByTestId("research-ownership")).toContainText("Data kepemilikan ≥1% belum tersedia");
    await expect(view.getByTestId("quality-ksei")).toHaveAttribute("data-status", "missing");
    await expect(view.getByTestId("research-version")).toHaveText("Versi skor: none (tanpa skor)");
    await expect(view.getByTestId("research-disclaimer")).toBeVisible();
  });

  test("reachable from the stock page header", async ({ page }) => {
    await page.goto("/en/stock/BBCA");
    await page.getByTestId("research-link").click();
    await expect(page).toHaveURL(/\/en\/research\/BBCA$/);
    await expect(page.getByTestId("research-summary")).toContainText("No score yet");
  });

  test("an unknown ticker says so", async ({ page }) => {
    await page.goto("/en/research/ZZZZ");
    await expect(page.getByTestId("research-view")).toContainText("Unknown ticker");
  });
});
