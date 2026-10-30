import { expect, test } from "@playwright/test";

test("market intelligence exposes history ranges and honest coverage states", async ({ page }) => {
  const historyRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/breadth/history")) historyRequests.push(request.url());
  });
  await page.goto("/id/discover/intelligence");
  const view = page.getByTestId("intelligence-view");

  await expect(view.getByTestId("breadth-history-panel")).toBeVisible();
  await expect(view.getByTestId("breadth-history-window")).toBeVisible();
  await expect(view.getByTestId("breadth-history-panel").getByTestId("data-state-code")).toHaveText("UNSUPPORTED");
  await view.getByTestId("breadth-history-window").getByRole("radio", { name: "6B" }).click();
  await expect.poll(() => historyRequests.some((url) => new URL(url).searchParams.get("window") === "6M")).toBe(true);
  await expect(view).not.toContainText(/BUY|SELL|strong buy|sell signal|beli|jual/i);
});

test("market breadth history renders sourced charts and latest sample coverage", async ({ page }) => {
  await page.route("**/api/breadth/history**", (route) => route.fulfill({ json: {
    data: {
      window: "3M", snapshotDate: "2026-10-28", source: "daily_prices", freshness: "EOD",
      series: [
        { date: "2026-10-27", advancers: 4, decliners: 2, unchanged: 1, comparable: 7, observed: 8, coverage: 0.875, netAdvanceRate: 2 / 7, cumulativePressure: 28.57, aboveSma20Pct: 0.6, aboveSma20Eligible: 5, advancingValueIdr: 400, decliningValueIdr: 100, valueObserved: 7, valueCoverage: 0.875, advancingValueShare: 0.8 },
        { date: "2026-10-28", advancers: 5, decliners: 2, unchanged: 1, comparable: 8, observed: 9, coverage: 8 / 9, netAdvanceRate: 3 / 8, cumulativePressure: 66.07, aboveSma20Pct: 0.75, aboveSma20Eligible: 4, advancingValueIdr: 500, decliningValueIdr: 200, valueObserved: 8, valueCoverage: 8 / 9, advancingValueShare: 5 / 7 },
      ],
    }, freshness: "EOD", asOf: "2026-10-28", source: "idx-bei",
  } }));
  await page.goto("/id/discover/intelligence");
  const panel = page.getByTestId("breadth-history-panel");

  await expect(panel.getByTestId("breadth-pressure-chart")).toBeVisible();
  await expect(panel.getByTestId("breadth-sma-chart")).toBeVisible();
  await expect(panel.getByTestId("breadth-turnover-chart")).toBeVisible();
  await expect(panel.locator('[data-freshness="EOD"]')).toBeVisible();
  await expect(panel.getByTestId("breadth-movement-coverage")).toContainText("8 dari 9 baris");
  await expect(panel.getByTestId("breadth-methodology")).toContainText("prediksi");
  await expect(panel).toContainText("4 saham dengan 20 harga penutupan");
});

test("foreign flow pulse labels estimates, observed coverage, and the latest stored session", async ({ page }) => {
  await page.route("**/api/foreign-flow/pulse", (route) => route.fulfill({ json: {
    data: {
      date: "2026-08-26",
      coverage: { priced: 3, observed: 2, ratio: 2 / 3 },
      totals: { netBuyers: 1, netSellers: 1, unchanged: 0, netShares: 1_000, netValueIdrEstimate: 1_250_000 },
      sectors: [
        { sector: "Finance", priced: 2, observed: 2, netShares: 1_500, netValueIdrEstimate: 2_000_000 },
        { sector: "Energy", priced: 1, observed: 0, netShares: 0, netValueIdrEstimate: 0 },
      ],
      history: [
        { date: "2026-08-24", priced: 3, observed: 2 },
        { date: "2026-08-25", priced: 3, observed: 3 },
        { date: "2026-08-26", priced: 3, observed: 2 },
      ],
    }, freshness: "STALE", asOf: "2026-08-26", source: "idx-bei",
  } }));

  await page.goto("/id/discover/intelligence");
  const panel = page.getByTestId("foreign-flow-pulse-panel");

  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-freshness="STALE"]')).toBeVisible();
  await expect(panel.getByTestId("foreign-flow-pulse-net-shares")).toContainText("+1 rb lembar");
  await expect(panel.getByTestId("foreign-flow-pulse-net-value")).toContainText("Rp1,25 jt");
  await expect(panel.getByTestId("foreign-flow-pulse-coverage")).toContainText("2 dari 3");
  await expect(panel.getByTestId("foreign-flow-pulse-sector-Finance")).toContainText("Finance");
  await expect(panel.getByTestId("foreign-flow-pulse-session")).toContainText("26 Agu 2026");
  await expect(panel.getByTestId("foreign-flow-pulse-history")).toContainText("24 Agu 2026");
  await expect(panel.getByTestId("foreign-flow-pulse-methodology")).toContainText("Estimasi nilai bersih");
  await expect(panel).not.toContainText(/buy signal|sell signal|rekomendasi beli|rekomendasi jual/i);
});
