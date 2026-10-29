import { expect, test } from "@playwright/test";

test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== "desktop", "desktop only"));

test("Broker Activity is a standalone module with gap-aware reported value analysis", async ({ page }) => {
  await page.route("**/api/brokers/market-summary**", (route) => route.fulfill({ json: {
    data: {
      dates: [
        { date: "2026-10-28", rowCount: 2, brokers: [
          { code: "YP", name: "Yapindo", value: 75_000_000_000, volume: 1_000_000, frequency: 10_000 },
          { code: "AD", name: "Ajaib", value: 25_000_000_000, volume: 500_000, frequency: 5_000 },
        ] },
        { date: "2026-10-30", rowCount: 2, brokers: [
          { code: "YP", name: "Yapindo", value: 40_000_000_000, volume: 900_000, frequency: 9_000 },
          { code: "CC", name: "Mandiri", value: 60_000_000_000, volume: 1_200_000, frequency: 12_000 },
        ] },
      ],
      coverage: { expectedDates: ["2026-10-28", "2026-10-29", "2026-10-30"], reportedSessions: 2, missingDates: ["2026-10-29"] },
    }, freshness: "EOD", asOf: "2026-10-30", source: "idx-primary",
  } }));

  await page.goto("/en/discover/ownership");
  await expect(page.getByTestId("nav-brokerActivity")).toBeVisible();
  await expect(page.getByTestId("nav-onePercent")).toBeVisible();
  await page.getByTestId("nav-brokerActivity").click();
  await expect(page).toHaveURL(/\/en\/discover\/broker-activity$/);
  await expect(page).toHaveTitle(/Broker Activity/);

  const view = page.getByTestId("broker-activity-view");
  await expect(view.getByRole("heading", { level: 1, name: "Broker Activity" })).toBeVisible();
  await expect(view.getByTestId("broker-session-coverage")).toHaveText("2 / 3");
  await expect(view.getByTestId("broker-activity-coverage")).toContainText("1 session has no broker summary");
  await expect(view.getByTestId("broker-activity-table").locator("tbody tr")).toHaveCount(2);
  await expect(view.getByTestId("broker-activity-methodology")).toContainText("does not identify ticker, trade side, client, or investor");
  await expect(view.getByTestId("broker-activity-history").locator('[data-freshness="EOD"]')).toBeVisible();
  await expect(view).not.toContainText(/buy signal|sell signal|strong buy|akumulasi|distribusi/i);
});
