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
