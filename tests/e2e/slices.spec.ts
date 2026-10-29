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

test.describe("slice 3b: Dividend patterns tab", () => {
  test("renders source-backed history, yield, and estimates with liquidity coverage", async ({ page }) => {
    await page.route("**/api/stocks/BBCA/dividend-patterns", (route) => route.fulfill({ json: {
      data: {
        symbol: "BBCA", asOf: "2026-10-28", close: 8100, priceHistoryFrom: "2021-10-28", averageValue20: 3_000_000_000, liquidityEligible: true,
        history: [{ exDate: "2026-05-20", amount: 250, cumDate: "2026-05-19", cumClose: 8200, exClose: 8000, runUpPercent: 2.5, exDropPercentOfDividend: 80, recoverySessions: 8, heldThroughExPercent: 0.61, observedSessionsAfterEx: 100 },
          { exDate: "2025-11-20", amount: 200, cumDate: "2025-11-19", cumClose: 7900, exClose: 7750, runUpPercent: 1.2, exDropPercentOfDividend: 75, recoverySessions: 10, heldThroughExPercent: 0.63, observedSessionsAfterEx: 200 }],
        projections: [{ exDate: "2026-11-19", amount: 200, basedOnExDate: "2025-11-20" }],
        yield: { trailing: 0.055, ahead: 0.055, selected: 0.055 },
        medians: { runUpPercent: 1.85, exDropPercentOfDividend: 77.5, recoverySessions: 9, heldThroughExPercent: 0.62 },
        recoveredWithin15Rate: 1, patterns: { lowTrapRisk: true, capture: true, runUp: false, highYield: false },
      }, freshness: "EOD", asOf: "2026-10-28", source: "yahoo-chart",
    } }));
    await page.goto("/en/stock/BBCA/dividends");
    const view = page.getByTestId("dividends-view");
    await expect(view).toContainText("5.5%");
    await expect(view).toContainText("Capture pattern");
    await expect(view).toContainText("EST");
    await expect(view).toContainText("May 20, 2026");
  });
});

test.describe("slice 4: Screener", () => {
  test("builder writes conditions to the URL; fixture mode states the source can't screen", async ({ page }) => {
    await page.goto("/en/discover/screener");
    await page.getByTestId("field-0").click();
    await page.getByRole("option", { name: "P/E (x)" }).click();
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
    await expect(view.getByTestId("breadth")).toContainText("2");
    await expect(view.getByRole("img", { name: /2 up, 1 down, 0 unchanged/ })).toBeVisible();
    await expect(view.getByTestId("stock-row-AAAA")).toContainText("+12.50%");
    await expect(view.getByTestId("stock-row-BBBB")).toHaveCount(0);
    await view.getByTestId("movers-losers").click();
    await expect(page).toHaveURL(/view=losers/);
    await expect(view.getByTestId("stock-row-CCCC")).toContainText("-6.20%");
  });

  test("news & disclosures render safely (intercepted, test-only)", async ({ page }) => {
    await page.route("**/api/news**", (route) => route.fulfill({ json: { data: [{ date: "2026-09-18", title: "Safe headline", summary: "Summary", url: "https://example.com/a", symbols: ["BBCA"] }, { date: "2026-09-17", title: "Unsafe headline", summary: null, url: "javascript:alert(1)" }], freshness: "HISTORICAL", asOf: "2026-09-18", source: "test-intercept" } }));
    await page.goto("/en/news");
    const list = page.getByTestId("news-list");
    await expect(list.getByRole("link", { name: "Safe headline" })).toHaveAttribute("href", "https://example.com/a");
    await expect(list.getByText("Unsafe headline")).toBeVisible();
    await expect(list.getByRole("link", { name: "Unsafe headline" })).toHaveCount(0);
    await expect(list.getByTestId("day-header")).toHaveCount(2);
    await expect(list.getByText("example.com").first()).toBeVisible();
    await expect(list.getByRole("link", { name: "BBCA" })).toHaveAttribute("href", /\/stock\/BBCA/);
    await page.getByTestId("tab-calendar").click();
    await expect(page.getByTestId("actions-calendar").getByTestId("data-state-code")).toHaveText("UNSUPPORTED");
    await page.getByTestId("tab-disclosures").click();
    await expect(page.getByTestId("announcement-list").getByTestId("data-state-code")).toHaveText("UNSUPPORTED");
  });

  test("calendar agenda groups by ex-date with countdowns (intercepted, test-only)", async ({ page }) => {
    const day = (offset: number) => new Date(Date.now() + 7 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
    await page.route("**/api/actions**", (route) => route.fulfill({ json: { data: [
      { symbol: "BBCA", date: day(3), type: "DIVIDEND", description: null, amount: 125, ratio: null, documentUrl: null },
      { symbol: "GOTO", date: day(3), type: "SPLIT", description: null, amount: null, ratio: "1:5", documentUrl: null },
      { symbol: "TLKM", date: day(-2), type: "DIVIDEND", description: null, amount: 80.5, ratio: null, documentUrl: null },
    ], freshness: "HISTORICAL", asOf: day(0), source: "test-intercept" } }));
    await page.goto("/en/news?tab=calendar");
    const calendar = page.getByTestId("actions-calendar");
    await expect(calendar.getByRole("link", { name: "KSEI cash-dividend schedule" })).toHaveAttribute("href", "https://web.ksei.co.id/publications/corporate-action-schedules/cash-dividend");
    await expect(calendar).toContainText("not a confirmed upcoming schedule");
    await expect(calendar.getByTestId("day-header")).toHaveCount(2);
    await expect(calendar.getByTestId("week-strip")).toBeVisible();
    await expect(calendar.getByText("in 3 days")).toHaveCount(2);
    await expect(calendar.getByText("2 days ago")).toBeVisible();
    await expect(calendar.getByText("1:5")).toBeVisible();
  });

  test("ownership changes: honest about market-wide data; stock lookup navigates", async ({ page }) => {
    await page.goto("/id/discover/ownership");
    // The fixture source has no KSEI ≥1% lists: the market-wide feed says the source lacks it, never an empty "no changes".
    await expect(page.getByTestId("ksei-changes").getByTestId("data-state-code")).toHaveText("UNSUPPORTED");
    // Same for the market-wide insider feed (a Data Engine capability), shown above the watchlist section.
    await expect(page.getByTestId("insider-feed")).toContainText("Transaksi insider 7 hari");
    await expect(page.getByTestId("insider-feed").getByTestId("data-state-code")).toHaveText("UNSUPPORTED");
    await page.getByTestId("ownership-symbol").fill("bbca");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/id\/stock\/BBCA\/insiders$/);
  });

  test("market-wide insider feed: states coverage plainly, filters buy/sell, and says when it has not run", async ({ page }) => {
    const tx = (symbol: string, action: "BUY" | "SELL", changeShares: number, priceIdr: number | null) => ({
      symbol, person: `${symbol} DIREKTUR`, date: "2026-10-15", action, nationality: "local", roles: ["DIREKTUR"], broker: null,
      previousShares: 1_000_000, currentShares: 1_000_000 + changeShares, changeShares, previousPercent: 0.01, currentPercent: 0.02, changePercent: 0.01,
      priceIdr, valueIdr: priceIdr === null ? null : Math.abs(changeShares) * priceIdr,
    });
    const actions: Array<string | null> = [];
    let running = true;
    await page.route("**/api/insiders/recent**", (route) => {
      const action = new URL(route.request().url()).searchParams.get("action");
      actions.push(action);
      const all = [tx("BBCA", "BUY", 500_000, 6000), tx("TLKM", "SELL", -200_000, null)];
      const rows = all.filter((row) => !action || row.action === action.toUpperCase());
      return route.fulfill({ json: running
        ? { data: { days: 7, from: "2026-10-14", to: "2026-10-21", action, coverage: { checked: 412, active: 951, revisitDays: 7, oldestCheck: "2026-10-15" }, transactions: rows }, freshness: "HISTORICAL", asOf: "2026-10-21T15:40:00.000Z", source: "test-intercept" }
        : { data: { days: 7, from: "2026-10-14", to: "2026-10-21", action: null, coverage: { checked: 0, active: 951, revisitDays: 7, oldestCheck: null }, transactions: [] }, freshness: "UNAVAILABLE", asOf: null, source: "test-intercept" } });
    });
    await page.goto("/id/discover/ownership");
    const feed = page.getByTestId("insider-feed");
    await expect(feed.getByTestId("insider-feed-coverage")).toContainText("Mencakup 412 dari 951 saham; diperbarui bergiliran.");
    await expect(feed.getByTestId("insider-feed-table")).toContainText("BBCA");
    await expect(feed.getByTestId("insider-feed-table")).toContainText("TLKM");
    await feed.getByTestId("insider-feed-sell").click();
    await expect(feed.getByTestId("insider-feed-table")).not.toContainText("BBCA");
    await expect(feed.getByTestId("insider-feed-table")).toContainText("TLKM");
    expect(actions).toContain("sell");
    // Before the first read: say the feed has not run, never "no transactions".
    running = false;
    await page.reload();
    await expect(feed).toContainText("Umpan insider lintas pasar belum berjalan");
  });

  test("/api/insiders/recent is its own route, not a stock code for /api/insiders/[code]", async ({ request }) => {
    const recent = await request.get("/api/insiders/recent?days=7&action=buy");
    // The fixture source has no market-wide feed; the per-stock route would answer NOT_RECORDED for a code "RECENT".
    expect((await recent.json()).error).toBe("UNSUPPORTED");
    expect((await request.get("/api/insiders/recent?days=31")).status()).toBe(400);
    expect((await (await request.get("/api/insiders/BBCA")).json()).data.symbol).toBe("BBCA");
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

  test("insiders: holders view groups disclosures by holder, with coverage and provenance", async ({ page }) => {
    await page.goto("/en/stock/BBCA/insiders");
    const holders = page.getByTestId("insider-holders");
    await expect(holders.getByTestId("holder-count")).toHaveText("10 holders");
    await expect(holders.getByTestId("holder-coverage")).toHaveText("Grouped from the newest 10 of 85 disclosures.");
    const first = holders.getByTestId("holder-row").first();
    await expect(first).toContainText("Identity not verified");
    await first.getByRole("button", { name: /Show disclosures for/ }).click();
    await expect(holders.getByTestId("holder-history")).toContainText("Source: fixture:arjum insider disclosures");
    // The recording ignores `page`, so older disclosures are reported unavailable instead of duplicated.
    await holders.getByTestId("load-older").click();
    await expect(holders.getByTestId("older-unavailable")).toBeVisible();
    await expect(holders.getByTestId("holder-count")).toHaveText("10 holders");
    await expect(holders.getByTestId("load-older")).toHaveCount(0);
  });

  test("insiders: contradictory same-day holdings are ambiguous; nominee accounts are not owners", async ({ page }) => {
    const base = { action: "BUY", nationality: "local", broker: null, previousShares: null, changeShares: null, previousPercent: null, changePercent: null, priceIdr: null };
    await page.route("**/api/insiders/BBCA?*", (route) => route.fulfill({ json: {
      data: { symbol: "BBCA", total: 3, page: 1, pageSize: 15, totalPages: 1, rows: [
        { ...base, person: "PT CONTOH HOLDCO", date: "2026-09-17", roles: [], currentShares: 2774000000, currentPercent: 61.13 },
        { ...base, person: "CONTOH HOLDCO", date: "2026-09-17", roles: [], currentShares: 2630000000, currentPercent: 57.98 },
        { ...base, person: "DBS VICKERS SECS SINGAPORE (PTE) LTD A/C CLIENTS", date: "2026-08-27", roles: [], currentShares: 1000, currentPercent: 1.2 },
      ] },
      freshness: "HISTORICAL", asOf: "2026-09-17", source: "arjum",
    } }));
    await page.goto("/en/stock/BBCA/insiders");
    const holders = page.getByTestId("insider-holders");
    await expect(holders.getByTestId("holder-count")).toHaveText("2 holders");
    const company = holders.locator('[data-testid="holder-row"][data-kind="organization"]');
    await expect(company.getByTestId("holding-ambiguous")).toContainText("Ambiguous");
    await expect(company.getByTestId("holding-ambiguous")).toContainText("61.13%");
    await expect(company.getByTestId("holding-ambiguous")).toContainText("57.98%");
    await expect(company).toContainText("Also disclosed as: CONTOH HOLDCO");
    const nominee = holders.locator('[data-testid="holder-row"][data-kind="nominee"]');
    await expect(nominee).toContainText("Custodian / nominee account");
    await expect(nominee.getByTestId("nominee-note")).toHaveText("An account registered on behalf of clients. It is not presented as the owner.");
  });

  test("insiders: paged table with action filter in the URL", async ({ page }) => {
    await page.goto("/en/stock/BBCA/insiders?view=transactions");
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

  test("ownership tab opens the investor network detail modal from a KSEI holder", async ({ page }) => {
    await page.route("**/api/stocks/BBCA/ownership", (route) => route.fulfill({ json: {
      data: { symbol: "BBCA", issuerName: "Bank Central Asia Tbk.", month: "2026-09", snapshotDate: "2026-09-30", thresholdPercent: "1.000000", issuedShares: "123000000000", source: { dataset: "ksei", reference: "ownership-2026-09", retrievedAt: "2026-10-01T00:00:00.000Z", uploadId: "fixture" },
        holders: [{ holderKey: "consilium-frontier-equity-fund-lp", holderName: "Consilium Frontier Equity Fund LP", holderKind: "organisation", shares: "2300000000", percent: "6.790000", investorType: "CP", localForeign: "Foreign", reference: "fixture#1" }],
        crossHoldings: [{ ownerSymbol: "BBCA", ownerName: "PT Bank Central Asia Tbk", heldSymbol: "BBRI", heldName: "PT Bank Rakyat Indonesia Tbk", shares: "500000000", percent: "1.250000", reciprocalShares: "100000000", reciprocalPercent: "0.250000", snapshotDate: "2026-09-30", sourceReference: "fixture#2", reciprocalSourceReference: "fixture#3" }], comparison: null, freeFloat: null },
      freshness: "HISTORICAL", asOf: "2026-09-30", source: "engine",
    } }));
    await page.goto("/en/stock/BBCA/ownership");
    await page.getByTestId("ownership-holder-consilium-frontier-equity-fund-lp").click();
    const modal = page.getByTestId("investor-network-dialog");
    await expect(modal).toContainText("Consilium Frontier Equity Fund LP");
    await expect(modal.getByTestId("investor-network-holdings")).toContainText("6.79%");
    await expect(modal.getByTestId("investor-network-graph")).toBeVisible();
    await expect(modal.getByTestId("investor-network-source-note")).toContainText("at or above 1%");
    await expect(modal.getByTestId("investor-network-source-note")).toContainText(/missing links do not prove/i);
    await expect(modal.getByTestId("investor-network-cross-holdings")).toContainText("BBCA ↔ BBRI");
    await expect(modal.getByTestId("investor-network-cross-holdings")).toContainText("1.25% / 0.25%");
  });
});

test.describe("alerts", () => {
  test("alerts page requires a user; reachable from Cmd+K", async ({ page }) => {
    await page.goto("/en/alerts?symbol=BBCA");
    await expect(page.getByRole("heading", { level: 1, name: "Alerts" })).toBeVisible();
    await expect(page.getByText("Sign in to create alerts.")).toBeVisible();
    await page.goto("/en/dashboard");
    await page.getByTestId("header-search").click();
    await page.getByTestId("palette-input").fill("alerts");
    await page.getByTestId("palette-page-alerts").click();
    await expect(page).toHaveURL(/\/en\/alerts$/);
  });
});
