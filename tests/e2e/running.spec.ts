import { expect, test } from "@playwright/test";

// Running Trade tab on fixture data (BBCA baseline: 100 rows of page 1 of 7,087). The tape is served on demand per
// page through the arjum done-details route; this checks the tab renders, paginates, and carries the disclaimer.
test("desktop: BBCA Running Trade tab shows the tape and paginates", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop flow");
  await page.goto("/id/stock/BBCA");

  await page.getByTestId("stock-tab-running").click();
  await expect(page).toHaveURL(/\/id\/stock\/BBCA\/running$/);

  const view = page.getByTestId("running-trade-view");
  await expect(view.getByRole("heading", { name: "Running trade" })).toBeVisible();
  const table = page.getByTestId("running-trade-table");
  await expect(table).toBeVisible();
  // Row 1 of the baseline recording: 16:18:00, board NG, broker AK on both sides.
  await expect(table).toContainText("16:18:00");
  await expect(table).toContainText("AK");

  // Page 1 of 7,087: previous disabled, next enabled.
  await expect(page.getByTestId("running-page")).toContainText("1");
  await expect(page.getByRole("button", { name: "Sebelumnya" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Berikutnya" })).toBeEnabled();

  // Research tool: the disclaimer is present. (Buy/Sell here label each trade's aggressor side, not advice.)
  await expect(view.getByTestId("research-disclaimer")).toBeVisible();
});
