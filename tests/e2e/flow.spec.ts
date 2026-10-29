import { expect, test } from "@playwright/test";

// Step 7 vertical slice on fixture data: Home → Strategies → Akumulasi Senyap → Why matched → Stock Overview.
test("desktop: Home → Strategies → why matched → stock research", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop flow");
  await page.goto("/id/dashboard");
  await expect(page.getByTestId("home-condition")).toContainText("FLAT MARKET");
  await expect(page.getByTestId("home-movers").getByTestId("data-state-code")).toHaveText("UNSUPPORTED");
  await expect(page.getByTestId("home-sectors").getByTestId("data-state-code")).toHaveText("UNSUPPORTED");
  await expect(page.getByTestId("home-strategies").getByTestId("research-disclaimer")).toBeVisible();

  await page.getByTestId("home-strategies-all").click();
  await expect(page).toHaveURL(/\/id\/discover\/strategies$/);
  await expect(page.getByRole("heading", { level: 1, name: "Strategi" })).toBeVisible();
  await page.getByTestId("strategy-akumulasi-senyap").click();
  await expect(page).toHaveURL(/\/id\/discover\/strategies\/akumulasi-senyap$/);
  await expect(page.getByRole("heading", { level: 1, name: "AKUMULASI SENYAP" })).toBeVisible();
  await expect(page.getByTestId("research-disclaimer")).toContainText("bukan rekomendasi jual atau beli");

  await page.getByTestId("why-SOCI").click();
  await expect(page).toHaveURL(/why=SOCI/);
  const why = page.getByTestId("why-matched");
  await expect(why).toContainText("SOCI masuk strategi AKUMULASI SENYAP");
  await expect(why.locator('[data-criterion="foreignBuying"]')).toHaveText("Asing membeli bersih");
  await expect(why.locator('[data-criterion="quietAccumulation"]')).toHaveText("Akumulasi tanpa lonjakan harga");
  await expect(why.getByTestId("research-disclaimer")).toBeVisible();
  // Never a recommendation.
  await expect(why).not.toContainText(/\b(BELI|JUAL|BUY|SELL|NETRAL|target)\b/);

  await why.getByTestId("why-research").click();
  await expect(page).toHaveURL(/\/id\/stock\/SOCI$/);
  // SOCI has no per-stock recording yet: one honest reason, no numbers.
  await expect(page.getByTestId("stock-overview").getByTestId("data-state-code").first()).toHaveText("NOT_RECORDED");
  await expect(page.getByTestId("overview-insights")).toHaveCount(0);
});

test("desktop: BBCA overview answers 'what should I know' before the tabs", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop flow");
  await page.goto("/id/stock/BBCA");
  await expect(page.getByTestId("stock-header-symbol")).toHaveText("BBCA");
  await expect(page.locator("header, main").getByText("Bank Central Asia Tbk.").first()).toBeVisible();
  const insights = page.getByTestId("overview-insights");
  await expect(page.getByTestId("insight-flow")).toContainText("Asing beli bersih di 0 dan jual bersih di 5 dari 5 sesi terakhir.");
  await expect(page.getByTestId("insight-brokers")).toContainText("Tidak ada broker dengan jual bersih");
  await expect(page.getByTestId("insight-ownership")).toContainText("10 transaksi insider terbaru: 10 beli, 0 jual.");
  await expect(page.getByTestId("insight-financials")).toContainText("Laporan terbaru: Q1 2026 (periode berakhir 31 Mar 2026).");
  await expect(page.getByTestId("insight-financials")).toContainText("Laporan periode 30 Jun 2026 seharusnya sudah tersedia");
  await expect(insights.locator('[data-freshness="LIVE"], [data-freshness="DELAYED"]')).toHaveCount(0);
  await expect(page.getByTestId("overview-chart").locator("canvas").first()).toBeVisible();
  await expect(page.getByTestId("deep-dive").getByRole("link")).toHaveCount(9);
  await expect(page.getByTestId("research-disclaimer")).toBeVisible();
});

test("mobile: More → Strategies → why matched in a bottom sheet", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile flow");
  await page.goto("/en/dashboard");
  await page.getByTestId("mobile-more").click();
  await page.getByRole("dialog").getByRole("link", { name: "Strategies" }).click();
  await page.getByTestId("strategy-akumulasi-senyap").click();
  await page.getByTestId("why-HRTA").click();
  await expect(page.getByTestId("why-matched")).toContainText("HRTA is in AKUMULASI SENYAP");
  const box = await page.getByTestId("drawer").boundingBox();
  expect(box!.y).toBeGreaterThan(100); // bottom sheet, not a side panel
  await page.getByTestId("why-research").click();
  await expect(page).toHaveURL(/\/en\/stock\/HRTA$/);
});
