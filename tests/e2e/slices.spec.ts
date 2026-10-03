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

test.describe("slice 3: Financials tab", () => {
  test("statement table, lag banner, row chart, URL state", async ({ page }) => {
    await page.goto("/id/stock/BBCA/financials");
    await expect(page.getByTestId("lag-banner")).toContainText("Laporan terbaru Q1 2026");
    const table = page.getByTestId("statement-table");
    await expect(table.locator("thead th").nth(1)).toHaveText("Q1 2026");
    await expect(table.locator('[data-key="laba_rugi"]')).toContainText("Rp14,69 T");
    // Empty insurance lines are hidden by default and revealed on request.
    await page.getByRole("button", { name: "Pendapatan Dan Beban Operasional" }).click();
    await expect(table.locator('[data-key="pendapatan_dan_beban_operasional.pendapatan_pengelolaan_dana_oleh_bank_sebagai_mudharib"]')).toHaveCount(0);
    await page.getByTestId("toggle-empty").click();
    await expect(page).toHaveURL(/empty=true/);
    await expect(table.locator('[data-key="pendapatan_dan_beban_operasional.pendapatan_pengelolaan_dana_oleh_bank_sebagai_mudharib"]')).toHaveCount(1);
    await table.getByRole("button", { name: "Pendapatan Bunga" }).first().click();
    await expect(page).toHaveURL(/row=pendapatan_dan_beban_operasional\.pendapatan_bunga/);
    await expect(page.getByTestId("statement-chart").locator(".recharts-bar-rectangle")).toHaveCount(12);
  });

  test("unrecorded report type says so", async ({ page }) => {
    await page.goto("/en/stock/BBCA/financials?report=BALANCE_SHEET");
    await expect(page.getByTestId("financials-view").getByTestId("data-state-code")).toHaveText("NOT_RECORDED");
  });
});
