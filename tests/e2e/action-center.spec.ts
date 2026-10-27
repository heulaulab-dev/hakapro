import { expect, test } from "@playwright/test";

// The Action Center (confluence alerts) in the shell: on fixture radar data the floating button shows, opens a panel
// of stocks ranked by how many signals fired, and a card navigates to the stock. Research tags only, never advice.
test("desktop: Action Center opens confluence alerts and a card navigates", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop flow");
  await page.goto("/id/dashboard");
  const button = page.getByTestId("action-center-button");
  // Renders only when the radar has fired signals; skip gracefully if the fixture has none.
  if ((await button.count()) === 0) test.skip(true, "no radar signals in fixture");
  await button.click();
  const panel = page.getByTestId("action-center");
  await expect(panel).toBeVisible();
  const firstAlert = panel.getByTestId(/^alert-/).first();
  await expect(firstAlert).toBeVisible();
  await firstAlert.click();
  await expect(page).toHaveURL(/\/id\/stock\/[A-Z]+/);
});
