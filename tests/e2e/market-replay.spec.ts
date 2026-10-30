import { expect, test } from "@playwright/test";

const day = (date: string, values: { advancers: number; decliners: number }) => ({
  date, ...values, unchanged: 2, comparable: 10, observed: 11, coverage: 10 / 11,
  netAdvanceRate: (values.advancers - values.decliners) / 10, cumulativePressure: 2,
  aboveSma20Pct: 0.6, aboveSma20Eligible: 8, advancingValueIdr: 30, decliningValueIdr: 20,
  valueObserved: 10, valueCoverage: 10 / 11, advancingValueShare: 0.6,
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/issuer-race**", (route) => route.fulfill({ json: {
    data: {
      window: "1M", sector: "all", sectors: ["Financials"], from: "2026-10-27", to: "2026-10-29", sessions: 3, frameStep: 1,
      universe: { active: 10, withBaseline: 8, truncated: false },
      frames: [
        { date: "2026-10-27", priced: 4, leaders: [{ symbol: "BBCA", name: "Bank Central Asia", sector: "Financials", close: 8000, returnPercent: 1.2 }] },
        { date: "2026-10-28", priced: 6, leaders: [{ symbol: "BBRI", name: "Bank Rakyat Indonesia", sector: "Financials", close: 4000, returnPercent: 2.4 }] },
        { date: "2026-10-29", priced: 7, leaders: [{ symbol: "BMRI", name: "Bank Mandiri", sector: "Financials", close: 5000, returnPercent: 3.6 }] },
      ],
    }, freshness: "EOD", asOf: "2026-10-29", source: "idx-bei",
  } }));
  await page.route("**/api/breadth/history**", (route) => route.fulfill({ json: {
    data: { window: "1M", snapshotDate: "2026-10-29", source: "idx-bei", freshness: "EOD", series: [day("2026-10-28", { advancers: 3, decliners: 5 }), day("2026-10-29", { advancers: 7, decliners: 2 })] },
    freshness: "EOD", asOf: "2026-10-29", source: "idx-bei",
  } }));
  await page.route("**/api/indices/history**", (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("from")).toBe("2026-10-27");
    expect(url.searchParams.get("to")).toBe("2026-10-29");
    return route.fulfill({ json: {
    data: { series: [
      { code: "COMPOSITE", name: "IHSG", points: [{ date: "2026-10-27", close: 7000 }, { date: "2026-10-28", close: 7070 }, { date: "2026-10-29", close: 7140 }] },
      { code: "IDXFINANCE", name: "IDX Financials", points: [{ date: "2026-10-27", close: 1500 }, { date: "2026-10-28", close: 1530 }, { date: "2026-10-29", close: 1560 }] },
    ] }, freshness: "EOD", asOf: "2026-10-29", source: "idx-bei",
    } });
  });
});

test("desktop: replay controls keep issuer, breadth, and sector values on the selected session", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop replay flow");
  await page.goto("/en/discover/market-replay");
  await expect(page.getByTestId("nav-marketReplay")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Market Replay" })).toBeVisible();

  const replay = page.getByTestId("market-replay");
  await expect(page.getByTestId("market-replay-data-asof")).toContainText("issuer race: Oct 29, 2026 · breadth: Oct 29, 2026 · indices: Oct 29, 2026");
  await expect(replay.getByTestId("market-replay-date")).toContainText("Oct 29, 2026");
  await expect(replay.getByTestId("market-replay-coverage")).toContainText("7 of 8");
  await expect(replay.getByTestId("market-replay-advancers")).toContainText("7");
  await expect(replay.getByTestId("market-replay-sector-return")).toContainText("+4.0%");
  await expect(replay.getByTestId("market-replay-ihsg-return")).toContainText("+2.0%");
  await expect(replay.getByTestId("market-replay-leader")).toContainText("BMRI");
  await replay.getByRole("button", { name: "Previous session" }).click();
  await expect(replay.getByTestId("market-replay-date")).toContainText("Oct 28, 2026");
  await expect(replay.getByTestId("market-replay-advancers")).toContainText("3");
  await expect(replay.getByTestId("market-replay-leader")).toContainText("BBRI");
  await replay.getByRole("button", { name: "Previous session" }).click();
  await expect(replay.getByTestId("market-replay-date")).toContainText("Oct 27, 2026");
  await expect(replay.getByTestId("market-replay-breadth-missing")).toBeVisible();
});

test("desktop: issuer-sector filter requests and shows only that sector's race", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop sector filter flow");
  await page.route("**/api/issuer-race**", (route) => {
    const url = new URL(route.request().url());
    const sector = url.searchParams.get("sector") ?? "all";
    const allLeaders = [
      { symbol: "BBCA", name: "Bank Central Asia", sector: "Finance", close: 8000, returnPercent: 3.6 },
      { symbol: "ADRO", name: "Alamtri Resources", sector: "Energy", close: 2100, returnPercent: 2.4 },
    ];
    return route.fulfill({ json: {
      data: {
        window: "1M", sector, sectors: ["Energy", "Finance"], from: "2026-10-27", to: "2026-10-29", sessions: 2, frameStep: 1,
        universe: { active: sector === "all" ? 10 : 5, withBaseline: sector === "all" ? 8 : 4, truncated: false },
        frames: [
          { date: "2026-10-28", priced: sector === "all" ? 2 : 1, leaders: sector === "all" ? allLeaders : sector === "Energy" ? allLeaders.slice(1) : allLeaders.slice(0, 1) },
          { date: "2026-10-29", priced: sector === "all" ? 2 : 1, leaders: sector === "all" ? allLeaders : sector === "Energy" ? allLeaders.slice(1) : allLeaders.slice(0, 1) },
        ],
      }, freshness: "EOD", asOf: "2026-10-29", source: "idx-bei",
    } });
  });

  await page.goto("/en/discover/market-replay");
  const replay = page.getByTestId("market-replay");
  await expect(replay.getByTestId("market-replay-leader").filter({ hasText: "ADRO" })).toBeVisible();
  await replay.getByTestId("market-replay-issuer-sector").click();
  await page.getByRole("option", { name: "Finance" }).click();
  await expect(replay.getByTestId("market-replay-leader").filter({ hasText: "BBCA" })).toBeVisible();
  await expect(replay.getByTestId("market-replay-leader").filter({ hasText: "ADRO" })).toHaveCount(0);
});

test("mobile: reduced motion keeps manual replay navigation and hides autoplay", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile reduced-motion flow");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/id/dashboard");
  await page.getByTestId("mobile-more").click();
  const modules = page.getByTestId("all-modules");
  await expect(modules.getByTestId("module-marketReplay")).toBeVisible();
  await modules.getByTestId("module-marketReplay").click();
  await expect(page).toHaveURL(/\/id\/discover\/market-replay$/);
  const replay = page.getByTestId("market-replay");
  await expect(replay.getByRole("button", { name: "Putar" })).toHaveCount(0);
  await expect(replay.getByRole("button", { name: "Sesi sebelumnya" })).toBeVisible();
});
