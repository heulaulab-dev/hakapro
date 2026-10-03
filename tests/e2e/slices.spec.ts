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

test.describe("slice 4: Screener", () => {
  test("builder writes conditions to the URL; fixture mode states the source can't screen", async ({ page }) => {
    await page.goto("/en/discover/screener");
    await page.getByTestId("field-0").selectOption("per");
    await page.getByTestId("value-0").fill("15");
    await page.getByTestId("screen-run").click();
    await expect(page).toHaveURL(/c=/);
    await expect(page.getByTestId("screener-view").getByTestId("data-state-code")).toHaveText("UNSUPPORTED");
    await expect(page.getByTestId("saved-screens")).toContainText("Sign in to save and load screens.");
  });

  test("results table renders and formats an idx-bei-shaped response (intercepted, test-only)", async ({ page }) => {
    await page.route("**/api/screener", (route) => route.fulfill({
      json: { data: { rows: [
        { symbol: "BBCA", name: "Bank Central Asia Tbk.", price: 6300, change1D: -0.79, value: 1_110_000_000_000, volume: 176_750_000, per: 18.2 },
        { symbol: "BBRI", name: "Bank Rakyat Indonesia (Persero) Tbk.", price: 3310, change1D: 1.25, value: 900_000_000_000, volume: 270_000_000, per: 10.4 },
      ], total: 2, supportedFields: ["price"] }, freshness: "EOD", asOf: "2026-09-18", source: "test-intercept" },
    }));
    await page.goto(`/id/discover/screener?c=${encodeURIComponent(JSON.stringify([{ field: "per", operator: "LT", value: 20, connective: "AND" }]))}`);
    const results = page.getByTestId("screen-results");
    await expect(results.getByTestId("row-count")).toHaveText("2 baris");
    await expect(results.locator("tbody tr").first()).toContainText("BBCA");
    await expect(results).toContainText("Rp1,11 T");
    await expect(results).toContainText("+1,25%");
    await expect(results).toContainText("18,2");
    await expect(results.locator('[data-freshness="EOD"]')).toBeVisible();
  });
});

test.describe("slice 5: Movers, News & Calendar, Ownership Changes", () => {
  test("movers: fixture states UNSUPPORTED for the session list; market caps come from arjum", async ({ page }) => {
    await page.goto("/en/discover/movers");
    await expect(page.getByTestId("movers-view").getByTestId("data-state-code").first()).toHaveText("UNSUPPORTED");
    await expect(page.getByTestId("largest-caps").getByTestId("stock-row-BBCA")).toContainText("Rp768.87T");
  });

  test("movers ranking with an idx-bei-shaped response (intercepted, test-only)", async ({ page }) => {
    await page.route("**/api/market", (route) => route.fulfill({ json: { data: {
      indices: [], breadth: { advancers: 2, decliners: 1, unchanged: 0, valueIdr: 1, volumeShares: 1, frequency: 1 },
      movers: [
        { symbol: "AAAA", name: "Liquid Gainer", close: 100, changePercent: 12.5, volumeShares: 1e7, valueIdr: 5e9, frequency: 10 },
        { symbol: "BBBB", name: "Illiquid Spike", close: 50, changePercent: 34, volumeShares: 1e3, valueIdr: 5e4, frequency: 1 },
        { symbol: "CCCC", name: "Liquid Loser", close: 80, changePercent: -6.2, volumeShares: 1e7, valueIdr: 2e9, frequency: 10 },
      ] }, freshness: "EOD", asOf: "2026-09-18", source: "test-intercept" } }));
    await page.goto("/en/discover/movers");
    const view = page.getByTestId("movers-view");
    await expect(view.getByTestId("stock-row-AAAA")).toContainText("+12.50%");
    await expect(view.getByTestId("stock-row-BBBB")).toHaveCount(0);
    await view.getByTestId("movers-losers").click();
    await expect(page).toHaveURL(/view=losers/);
    await expect(view.getByTestId("stock-row-CCCC")).toContainText("-6.20%");
  });

  test("news & disclosures render safely (intercepted, test-only)", async ({ page }) => {
    await page.route("**/api/news**", (route) => route.fulfill({ json: { data: [{ date: "2026-09-18", title: "Safe headline", summary: "Summary", url: "https://example.com/a" }, { date: "2026-09-17", title: "Unsafe headline", summary: null, url: "javascript:alert(1)" }], freshness: "HISTORICAL", asOf: "2026-09-18", source: "test-intercept" } }));
    await page.goto("/en/news");
    const list = page.getByTestId("news-list");
    await expect(list.getByRole("link", { name: "Safe headline" })).toHaveAttribute("href", "https://example.com/a");
    await expect(list.getByText("Unsafe headline")).toBeVisible();
    await expect(list.getByRole("link", { name: "Unsafe headline" })).toHaveCount(0);
    await page.getByTestId("tab-disclosures").click();
    await expect(page.getByTestId("announcement-list").getByTestId("data-state-code")).toHaveText("UNSUPPORTED");
  });

  test("ownership changes: honest about market-wide data; stock lookup navigates", async ({ page }) => {
    await page.goto("/id/discover/ownership");
    await expect(page.getByTestId("ownership-view")).toContainText("Umpan perubahan kepemilikan lintas pasar belum tersedia");
    await page.getByTestId("ownership-symbol").fill("bbca");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/id\/stock\/BBCA\/insiders$/);
  });
});

test.describe("slice 6: Chart, Insiders, History, Ownership tabs", () => {
  test("chart indicators are URL state with a legend", async ({ page }) => {
    await page.goto("/en/stock/BBCA/chart");
    await page.getByTestId("ind-sma20").click();
    await page.getByTestId("ind-macd").click();
    await expect(page).toHaveURL(/ind=sma20(%2C|,)macd/);
    const legend = page.getByTestId("chart-legend");
    await expect(legend).toContainText("SMA 20");
    await expect(legend).toContainText("MACD (12, 26)");
    await expect(page.getByTestId("full-chart").locator("canvas").first()).toBeVisible();
  });

  test("insiders: paged table with action filter in the URL", async ({ page }) => {
    await page.goto("/en/stock/BBCA/insiders");
    const view = page.getByTestId("insiders-view");
    await expect(view.getByTestId("row-count")).toHaveText("10 rows");
    await expect(view.getByTestId("insider-page")).toHaveText("Page 1 of 9");
    await view.getByTestId("insider-action-SELL").click();
    await expect(page).toHaveURL(/action=SELL/);
    await expect(view.getByTestId("row-count")).toHaveText("0 rows");
  });

  test("history: daily table, localized seasonality heatmap, latest trades", async ({ page }) => {
    await page.goto("/id/stock/BBCA/history");
    await expect(page.getByTestId("history-table").getByTestId("row-count")).toHaveText("120 baris");
    const heatmap = page.getByTestId("seasonality");
    await expect(heatmap.locator("thead th").nth(5)).toHaveText("Mei");
    await expect(heatmap).toContainText("-16,9%");
    await expect(page.getByTestId("tape-table").getByTestId("row-count")).toHaveText("100 baris");
  });

  test("ownership tab states the idx-bei source is absent in fixture mode", async ({ page }) => {
    await page.goto("/en/stock/BBCA/ownership");
    await expect(page.getByTestId("stock-ownership-view").getByTestId("data-state-code").first()).toHaveText("UNSUPPORTED");
  });
});
