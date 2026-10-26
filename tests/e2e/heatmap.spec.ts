import { expect, test } from "@playwright/test";

// Fixture mode has no Data Engine: the heatmap says so (UNSUPPORTED) instead of drawing an empty or fake map.
test("market heatmap: UNSUPPORTED in fixture mode, controls kept in the URL", async ({ page }) => {
  await page.goto("/id/discover/heatmap");
  const view = page.getByTestId("heatmap-view");
  await expect(page.getByRole("heading", { level: 1, name: "Peta Pasar" })).toBeVisible();
  await expect(page.getByTestId("heatmap-panel").getByTestId("data-state-code")).toHaveText("UNSUPPORTED");
  await expect(page.getByTestId("heatmap-panel").locator('[data-testid^="heatmap-tile-"]')).toHaveCount(0);

  await page.getByTestId("heatmap-limit-30").click();
  await expect(page).toHaveURL(/top=30/);
  await expect(page.getByTestId("heatmap-panel")).toContainText("Top 30");
  await page.getByTestId("heatmap-view-toggle-pulse").click();
  await expect(page).toHaveURL(/view=pulse/);
  await expect(page.getByTestId("heatmap-panel").getByTestId("data-state-code")).toHaveText("UNSUPPORTED");
  // Descriptive only: never an advice label.
  await expect(view).not.toContainText(/\b(BELI|JUAL|BUY|SELL)\b/);
  await expect(view).not.toContainText(/\b(akumulasi|accumulate|strong|kuat)\b/i);
});
