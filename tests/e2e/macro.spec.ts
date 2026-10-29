import { expect, test } from "@playwright/test";

// Rates & Commodities page. On fixture data the engine macro lane is UNSUPPORTED, so the data area shows that state;
// the page frame and the research disclaimer still render. (Live data is checked against the engine, not in e2e.)
test("desktop: Rates & Commodities page renders", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop flow");
  await page.goto("/id/discover/macro");
  await expect(page.getByTestId("macro-view")).toBeVisible();
  await expect(page.getByTestId("macro-view").getByTestId("data-state-code")).toHaveText("UNSUPPORTED");
  await expect(page.getByTestId("research-disclaimer")).toBeVisible();
});

test("official BI meeting dates are visible with their source and publication date", async ({ page }) => {
  await page.goto("/id/news?tab=macro");
  const calendar = page.getByTestId("macro-calendar");
  await expect(calendar).toBeVisible();
  await expect(calendar.getByText("15 Des 2026", { exact: false })).toBeVisible();
  await expect(calendar.getByText("22 Des 2025", { exact: false })).toBeVisible();
  await expect(calendar.getByRole("link", { name: /jadwal resmi BI/i })).toHaveAttribute("href", /bi\.go\.id/);
});
