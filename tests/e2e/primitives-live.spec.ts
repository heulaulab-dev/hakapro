import { expect, test } from "@playwright/test";

// Data comes through the real BFF routes; the dev server runs in fixture mode.
test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== "desktop", "desktop only"));

test("history-driven primitives show recorded BBCA data with freshness", async ({ page }) => {
  await page.goto("/id/dev/primitives");
  const stories = page.getByTestId("history-stories");
  await expect(stories.getByTestId("stock-header-symbol")).toHaveText("BBCA");
  await expect(stories).toContainText("Rp6.300");
  await expect(stories).toContainText("176,75 jt lembar");
  await expect(stories).toContainText("1,77 jt lot");
  await expect(stories.locator('[data-freshness="HISTORICAL"]').first()).toBeVisible();
  await expect(stories.locator('[data-freshness="LIVE"], [data-freshness="DELAYED"]')).toHaveCount(0);
});

test("chart range lives in the URL and the chart has a table view", async ({ page }) => {
  await page.goto("/en/dev/primitives");
  const card = page.getByTestId("price-chart-card");
  await expect(card.getByTestId("price-chart").locator("canvas").first()).toBeVisible();
  await card.getByTestId("range-1M").click();
  await expect(page).toHaveURL(/range=1M/);
  await card.getByRole("button", { name: "Show table" }).click();
  await expect(card.getByTestId("row-count")).toHaveText("21 rows");
  await page.goto("/en/dev/primitives?range=1Y");
  await expect(page.getByTestId("price-chart-card")).toContainText("120 trading days available.");
});

test("broker diverging bars and sortable broker table", async ({ page }) => {
  await page.goto("/en/dev/primitives");
  const card = page.getByTestId("broker-chart-card");
  await expect(card.locator(".recharts-bar-rectangle").first()).toBeVisible();
  await card.getByRole("button", { name: "Show table" }).click();
  await expect(card.getByTestId("row-count")).toHaveText("20 rows");
  await expect(card.locator("tbody tr").nth(0)).toContainText("YU");
});

test("screener table lists why each stock matched", async ({ page }) => {
  await page.goto("/id/dev/primitives");
  const table = page.getByTestId("screener-table");
  await expect(table.getByTestId("screener-symbol-SOCI")).toBeVisible();
  await expect(table.getByTestId("screener-symbol-HRTA")).toBeVisible();
  await expect(table.locator('[data-criterion="foreignBuying"]').first()).toHaveText("Asing membeli bersih");
  await expect(table.locator('[data-criterion="quietAccumulation"]').first()).toHaveText("Akumulasi tanpa lonjakan harga");
});

test("filters and tabs are URL state; drawer shows details", async ({ page }) => {
  await page.goto("/en/dev/primitives");
  await page.getByTestId("filter-q").fill("bbca");
  await expect(page).toHaveURL(/q=bbca/);
  const story = page.getByTestId("marketcap-story");
  await expect(story.locator('[data-testid^="stock-row-"]')).toHaveCount(1);
  await story.getByTestId("drawer-open-BBCA").click();
  await expect(page.getByTestId("drawer")).toContainText("Rp768.87T");
  await page.keyboard.press("Escape");
  await page.getByTestId("tab-insiders").click();
  await expect(page).toHaveURL(/tab=insiders/);
  const insiders = page.getByTestId("insiders-table");
  await expect(insiders.getByTestId("row-count")).toHaveText("10 rows");
  await insiders.getByTestId("chip-action-SELL").click();
  await expect(page).toHaveURL(/action=SELL/);
  await expect(insiders.getByTestId("row-count")).toHaveText("0 rows");
});

test("unrecorded data shows its reason instead of numbers", async ({ page }) => {
  await page.goto("/en/dev/primitives");
  const story = page.getByTestId("not-recorded-story");
  await expect(story.getByTestId("data-state-code")).toHaveText("NOT_RECORDED");
  await expect(story).toContainText("No fixture recording exists for this data yet.");
});
