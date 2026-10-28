import { expect, test } from "@playwright/test";

// Sector Rotation (RRG) workspace. Fixture mode still covers the unsupported state; the second test intercepts the
// history endpoint with deterministic UI-contract data to cover successful rendering without claiming live coverage.
test("desktop: Sector Rotation page renders with the unavailable state in fixture mode", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop flow");
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
  await page.goto("/id/discover/rotation");

  await expect(page.getByTestId("rotation-source-coverage")).toBeVisible();
  await expect(page.getByTestId("source-coverage-IDXNONCYC")).toContainText("40");
  await expect(page.getByTestId("rotation-insufficient")).toHaveCount(0);
  await expect(page.getByTestId("rotation-rankings")).toBeVisible();
  await expect(page.getByTestId("rank-IDXNONCYC")).toBeVisible();
  await expect(page.getByTestId("rotation-playback")).toBeVisible();
});
