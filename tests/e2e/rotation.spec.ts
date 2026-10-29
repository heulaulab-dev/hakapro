import { expect, test } from "@playwright/test";

// Sector Rotation (RRG) workspace. Fixture mode still covers the unsupported state; the second test intercepts the
// history endpoint with deterministic UI-contract data to cover successful rendering without claiming live coverage.
test("desktop: Sector Rotation page renders with the unavailable state in fixture mode", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop flow");
  await page.route("**/api/issuer-race**", (route) => route.fulfill({ json: { data: {
    window: "3M", sector: "all", sectors: [], from: null, to: null, sessions: 0, frameStep: 1,
    universe: { active: 0, withBaseline: 0, truncated: false }, frames: [],
  }, freshness: "UNAVAILABLE", asOf: null, source: "fixture" } }));
  await page.goto("/id/discover/rotation");
  await expect(page.getByTestId("rotation-view")).toBeVisible();
  await expect(page.getByTestId("rotation-experimental")).toBeVisible();
  await expect(page.getByTestId("rotation-view").getByTestId("data-state-code")).toHaveText("UNSUPPORTED");
  await expect(page.getByTestId("research-disclaimer")).toBeVisible();
});

test("desktop: Sector Rotation renders history coverage and RRG when IDX observations are available", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop flow");
  // UI contract fixture only; this does not represent live IDX or production coverage.
  const codes = ["COMPOSITE", "IDXNONCYC", "IDXCYCLIC", "IDXTECHNO", "IDXINFRA", "IDXTRANS"];
  const dates: string[] = [];
  const date = new Date("2026-01-01T00:00:00Z");
  while (dates.length < 40) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) dates.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  const series = codes.map((code, codeIndex) => ({
    code,
    name: code,
    points: dates.map((day, i) => {
      const benchmark = 7_000 + i * 4;
      const relative = code === "COMPOSITE" ? 1 : 0.7 + i * 0.001 + Math.sin(i * 0.41 + codeIndex) * 0.025;
      return { date: day, close: benchmark * relative };
    }),
  }));
  const coverage = series.map(({ code }) => ({
    code, name: code, count: 40, firstDate: dates[0], lastDate: dates.at(-1)!,
    spanTradingDays: 40, missingSessions: 0, staleTradingDays: 0, flags: [],
  }));
  await page.route("**/api/indices/history**", (route) => route.fulfill({ json: {
    data: { series, coverage }, freshness: "HISTORICAL", asOf: dates.at(-1), source: "idx-primary",
  } }));
  await page.route("**/api/issuer-race**", (route) => route.fulfill({ json: { data: {
    window: "3M", sector: "all", sectors: ["Finance"], from: dates[0], to: dates.at(-1), sessions: 2, frameStep: 1,
    universe: { active: 2, withBaseline: 2, truncated: false }, frames: [
      { date: dates[1], priced: 2, leaders: [
        { symbol: "BBCA", name: "Bank Central Asia", sector: "Finance", close: 105, returnPercent: 5 },
        { symbol: "BBRI", name: "Bank Rakyat Indonesia", sector: "Finance", close: 98, returnPercent: -2 },
      ] },
    ],
  }, freshness: "HISTORICAL", asOf: dates.at(-1), source: "hakapro-engine" } }));
  await page.goto("/id/discover/rotation");

  await expect(page.getByTestId("rotation-source-coverage")).toBeVisible();
  await expect(page.getByTestId("source-coverage-IDXNONCYC")).toContainText("40");
  await expect(page.getByTestId("rotation-insufficient")).toHaveCount(0);
  await expect(page.getByTestId("rotation-rankings")).toBeVisible();
  await expect(page.getByTestId("rank-IDXNONCYC")).toBeVisible();
  await expect(page.getByTestId("rotation-playback")).toBeVisible();
  await expect(page.getByTestId("issuer-race")).toBeVisible();
  await expect(page.getByTestId("issuer-race-row-BBCA")).toContainText("+5.0%");
  await expect(page.getByTestId("issuer-race-coverage")).toContainText("2 memiliki harga hari ini");
});
