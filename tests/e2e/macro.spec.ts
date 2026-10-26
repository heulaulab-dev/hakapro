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
