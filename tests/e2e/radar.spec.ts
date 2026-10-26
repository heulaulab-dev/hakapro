import { expect, test } from "@playwright/test";

test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== "desktop", "desktop only"));

// Fixture mode has no Data Engine: the radar and the KSEI view say so plainly; the methodology renders from the rules.
test.describe("signal radar, KSEI corporate view and methodology (fixture data)", () => {
  // `next dev` compiles each page and API route on first request; under load that alone can take tens of seconds.
  test.describe.configure({ timeout: 90_000 });
  test("radar states the data source is absent, with the research note and the methodology link", async ({ page }) => {
    await page.goto("/id/discover/radar");
    const view = page.getByTestId("radar-view");
    await expect(view.getByRole("heading", { level: 1 })).toHaveText("Radar Konfluensi Sinyal");
    await expect(view.getByTestId("data-state-code")).toHaveText("UNSUPPORTED", { timeout: 45_000 });
    await expect(view.getByTestId("research-disclaimer")).toBeVisible();
    await view.getByTestId("radar-methodology-link").click();
    await expect(page).toHaveURL(/\/id\/methodology$/);
    await expect(page.getByTestId("methodology-view")).toBeVisible();
  });

  test("KSEI corporate view states the data source is absent", async ({ page }) => {
    await page.goto("/en/discover/stealth");
    const view = page.getByTestId("stealth-view");
    await expect(view.getByRole("heading", { level: 1 })).toHaveText("Corporate Holders Up, Price Flat");
    await expect(view.getByTestId("data-state-code")).toHaveText("UNSUPPORTED", { timeout: 45_000 });
    await expect(view.getByTestId("research-disclaimer")).toBeVisible();
  });

  test("methodology lists sources, every signal threshold from the rules, counter-evidence and why there is no score", async ({ page }) => {
    await page.goto("/id/methodology");
    const view = page.getByTestId("methodology-view");
    await expect(view.getByTestId("source-arjum")).toContainText("19.00");
    await expect(view.getByTestId("source-ksei")).toContainText("Bulanan");
    await expect(view.getByTestId("threshold-volumeSpike")).toHaveText("≥ 2×");
    await expect(view.getByTestId("threshold-foreignNetBuy5")).toHaveText("≥ 5,0%");
    await expect(view.getByTestId("threshold-kseiHolderIncrease")).toHaveText("≥ 1");
    await expect(view.getByTestId("methodology-signals").locator("tbody tr")).toHaveCount(7);
    await expect(view.getByTestId("methodology-counter").locator("li")).toHaveCount(4);
    await expect(view.getByTestId("methodology-radar-version")).toContainText("radar-v0.1-draft");
    await expect(view.getByTestId("methodology-no-score")).toContainText("belum dilakukan");
    await expect(view.getByTestId("methodology-disclaimer")).toBeVisible();
  });

  test("methodology in English renders the same thresholds", async ({ page }) => {
    await page.goto("/en/methodology");
    await expect(page.getByTestId("methodology-no-score")).toContainText("Why there is no score");
    await expect(page.getByTestId("threshold-foreignNetBuy5")).toHaveText("≥ 5.0%");
  });

  test("discover navigation reaches the radar and the KSEI view", async ({ page }) => {
    await page.goto("/id/discover/movers");
    await page.getByTestId("nav-radar").click();
    await expect(page).toHaveURL(/\/id\/discover\/radar$/);
    await page.getByTestId("nav-stealth").click();
    await expect(page).toHaveURL(/\/id\/discover\/stealth$/);
  });
});
