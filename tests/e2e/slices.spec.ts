import { expect, test } from "@playwright/test";

test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== "desktop", "desktop only"));

test.describe("slice 2: Flow tab", () => {
  test("foreign flow, broker summary and accumulation with freshness and table views", async ({ page }) => {
    await page.goto("/en/stock/BBCA/flow");
    const view = page.getByTestId("flow-view");
    await expect(view).toContainText("Net foreign, 63 sessions");
    await expect(view).toContainText("+34.08M shares");
    await expect(page.getByTestId("foreign-chart").locator(".recharts-bar-rectangle").first()).toBeVisible();
    await page.getByTestId("foreign-chart").getByRole("button", { name: "Show table" }).click();
    await expect(page.getByTestId("foreign-chart").getByTestId("row-count")).toHaveText("63 rows");
    await expect(page.getByTestId("broker-summary").locator(".recharts-bar-rectangle").first()).toBeVisible();
    const accumulation = page.getByTestId("broker-accumulation");
    await expect(accumulation.locator(".recharts-line").first()).toBeVisible();
    await expect(accumulation.locator(".recharts-line")).toHaveCount(6);
    await expect(accumulation).toContainText("UBS SEKURITAS INDONESIA");
    await expect(view.locator('[data-freshness="LIVE"], [data-freshness="DELAYED"]')).toHaveCount(0);
    await page.getByTestId("range-1M").click();
    await expect(view).toContainText("Net foreign, 21 sessions");
  });

  test("unrecorded stock shows reasons on the Flow tab", async ({ page }) => {
    await page.goto("/en/stock/HRTA/flow");
    await expect(page.getByTestId("flow-view").getByTestId("data-state-code").first()).toHaveText("NOT_RECORDED");
  });
});
