import { expect, test } from "@playwright/test";

// The mobile "all modules" grid (BDMFlow-style terminal menu): tap More → grouped module cards → a module opens.
test("mobile: More opens the grouped module grid and a module navigates", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile flow");
  await page.goto("/id/dashboard");
  await page.getByTestId("mobile-more").click();
  const modules = page.getByTestId("all-modules");
  await expect(modules).toBeVisible();
  // Grouped labels from the module menu.
  await expect(modules.getByRole("heading", { name: "Denyut Pasar" })).toBeVisible();
  await expect(modules.getByRole("heading", { name: "Bandar & Asing" })).toBeVisible();
  // A module card opens its page.
  await page.getByTestId("module-screener").click();
  await expect(page).toHaveURL(/\/id\/discover\/screener$/);
});
