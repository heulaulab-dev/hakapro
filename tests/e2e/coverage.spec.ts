import { expect, test, type Locator, type Page } from "@playwright/test";

/** Opens a DatePicker and clicks the ISO day, stepping back month by month until it is shown. */
async function pickDate(page: Page, trigger: Locator, iso: string) {
  await trigger.click();
  const dialog = page.locator("[data-slot=popover-content]");
  const day = dialog.locator(`[data-day="${iso}"]:not([data-outside]) button`);
  for (let step = 0; step < 24 && !(await day.isVisible()); step += 1) await dialog.locator(".rdp-button_previous").click();
  await day.click();
  await expect(dialog).toBeHidden();
}


// Full arjum coverage (2026-10-04): analysis tab, broker-summary controls, history ranges, tape paging,
// financial filters and market-cap paging. Fixture mode serves recordings; parameters land in the URL.
test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== "desktop", "desktop only"));

test.describe("analysis tab", () => {
  test("structured analysis in HAKAPRO's words, never the provider's", async ({ page }) => {
    await page.goto("/en/stock/BBCA/analysis");
    const view = page.getByTestId("analysis-view");
    await expect(page.getByTestId("stock-tab-analysis")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("analysis-score-value")).toHaveText("25");
    await expect(page.getByTestId("analysis-score")).toContainText("of 75");
    await expect(page.getByTestId("analysis-stance")).toHaveText("Avoid for now");
    await expect(page.getByTestId("analysis-factors")).toContainText("Foreign investors net selling");
    await expect(page.getByTestId("analysis-technical")).toContainText("RSI (14)");
    await expect(page.getByTestId("analysis-brokers")).toContainText("73 brokers traded in the session.");
    await expect(page.getByTestId("analysis-patterns").getByTestId("row-count")).toHaveText("2 rows");
    await expect(page.getByTestId("analysis-patterns")).toContainText("Strong foreign selling");
    await expect(page.getByTestId("analysis-patterns")).toContainText("44.9%");
    await expect(page.getByTestId("analysis-patterns")).not.toContainText("+44.9%");
    for (const providerWord of ["NETRAL", "AVOID", "Cut loss", "DISCLAIMER", "Jika", "Heavy buyer:", "asing jual kuat"]) await expect(view).not.toContainText(providerWord);
    await expect(view.locator('[data-freshness="LIVE"]')).toHaveCount(0);
    await expect(page.getByTestId("research-disclaimer")).toBeVisible();
  });

  test("Indonesian labels; unrecorded stock says why", async ({ page }) => {
    await page.goto("/id/stock/BBCA/analysis");
    await expect(page.getByTestId("analysis-stance")).toHaveText("Hindari dulu");
    await page.goto("/en/stock/HRTA/analysis");
    await expect(page.getByTestId("analysis-view").getByTestId("data-state-code").first()).toHaveText("NOT_RECORDED");
  });
});

test.describe("flow tab: broker summary controls", () => {
  test("investor type, net mode, count and period are URL state; paired levels render", async ({ page }) => {
    await page.goto("/en/stock/BBCA/flow");
    const levels = page.getByTestId("broker-levels");
    await expect(levels.getByTestId("row-count")).toHaveText("25 rows");
    await expect(levels).toContainText("Avg price");
    await page.getByTestId("broker-flow-foreign").click();
    await expect(page).toHaveURL(/bflow=foreign/);
    await page.getByTestId("broker-net").click();
    await expect(page).toHaveURL(/bnet=true/);
    await page.getByTestId("broker-period-range").click();
    await expect(page).toHaveURL(/bperiod=range/);
    await page.getByTestId("broker-count").click();
    await page.getByRole("option", { name: "All brokers" }).click();
    await expect(page).toHaveURL(/bcount=200/);
    await expect(page.getByTestId("broker-summary")).toContainText("Broker data available");
  });

  test("accumulation broker filter keeps valid codes only", async ({ page }) => {
    await page.goto("/en/stock/BBCA/flow");
    const filter = page.getByTestId("accumulation-filter");
    await filter.getByRole("textbox").fill("bk, zp, not-a-code");
    await filter.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/acc=BK%2CZP|acc=BK,ZP/);
    await expect(filter.getByRole("textbox")).toHaveValue("BK, ZP");
  });
});

test.describe("history tab: ranges and trade tape", () => {
  test("date range is URL state; tape has a date picker and pages", async ({ page }) => {
    await page.goto("/en/stock/BBCA/history");
    await expect(page.getByTestId("tape-page")).toHaveText("Page 1 of 7087");
    await page.getByTestId("tape-next").click();
    await expect(page).toHaveURL(/tpage=2/);
    await page.getByTestId("tape-date").click();
    await page.getByRole("option").nth(1).click();
    await expect(page).toHaveURL(/tdate=\d{4}-\d{2}-\d{2}/);
    await expect(page).not.toHaveURL(/tpage=/);
    const range = page.getByTestId("history-range");
    await pickDate(page, range.getByLabel("From"), "2026-09-01");
    await pickDate(page, range.getByLabel("To"), "2026-09-18");
    await range.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/from=2026-09-01/);
    await expect(page).toHaveURL(/to=2026-09-18/);
    await range.getByRole("button", { name: "Reset" }).click();
    await expect(page).not.toHaveURL(/from=/);
  });
});

test.describe("financials and movers filters", () => {
  test("financials year and period count are URL state", async ({ page }) => {
    await page.goto("/en/stock/BBCA/financials");
    await page.getByTestId("financials-periods").click();
    await page.getByRole("option", { name: "40 periods" }).click();
    await expect(page).toHaveURL(/periods=40/);
    await page.getByTestId("financials-year").click();
    await page.getByRole("option", { name: "2025" }).click();
    await expect(page).toHaveURL(/year=2025/);
    await expect(page.getByTestId("financials-periods")).toHaveCount(0);
  });

  test("largest market caps page through the provider's list", async ({ page }) => {
    await page.goto("/en/discover/movers");
    const caps = page.getByTestId("largest-caps");
    await expect(caps.getByTestId("caps-page")).toHaveText("Page 1 of 39");
    await expect(caps).toContainText("963 stocks");
    await caps.getByTestId("caps-next").click();
    await expect(page).toHaveURL(/cpage=2/);
  });
});
