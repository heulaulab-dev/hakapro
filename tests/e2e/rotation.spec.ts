import { expect, test } from "@playwright/test";

// Sector Rotation (RRG) workspace. On fixture data the engine index-history lane is UNSUPPORTED, so the data area
// shows that state; the page frame, the experimental-data note and the research disclaimer still render. The RRG
// itself and the insufficient-data workspace are exercised by the unit tests (src/lib/sector-rotation.test.ts) with
// controlled series — not in e2e, where no engine history is available.
test("desktop: Sector Rotation page renders with the unavailable state in fixture mode", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop flow");
  await page.goto("/id/discover/rotation");
  await expect(page.getByTestId("rotation-view")).toBeVisible();
  await expect(page.getByTestId("rotation-experimental")).toBeVisible();
  await expect(page.getByTestId("rotation-view").getByTestId("data-state-code")).toHaveText("UNSUPPORTED");
  await expect(page.getByTestId("research-disclaimer")).toBeVisible();
});
