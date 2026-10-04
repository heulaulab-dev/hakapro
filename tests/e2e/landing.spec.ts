import { expect, test } from "@playwright/test";

test.describe("about / landing page", () => {
  test("Indonesian by default, English available; sections, CTAs and anchors", async ({ page }) => {
    await page.goto("/id/about");
    await expect(page.getByTestId("landing-title")).toHaveText("Riset saham BEI, tiap angka jelas tanggalnya.");
    await expect(page.getByTestId("app-shell")).toHaveCount(0);
    await expect(page.getByTestId("landing-facts").locator("dd")).toHaveCount(4);
    await expect(page.getByTestId("landing-freshness").locator("[data-freshness]")).toHaveCount(5);
    await expect(page.getByTestId("landing-freshness").locator('[data-freshness="LIVE"]')).toHaveCount(0);
    await expect(page.getByTestId("landing-faq").locator("details")).toHaveCount(6);
    // e2e runs with the dev auth bypass, so the CTA opens the app.
    await expect(page.getByTestId("landing-hero-cta").getByRole("link")).toHaveAttribute("href", "/id");
    await page.goto("/en/about");
    await expect(page.getByTestId("landing-title")).toHaveText("IDX stock research, with every number dated.");
    await expect(page).toHaveTitle(/About HAKAPRO/);
  });

  test("names no data vendor", async ({ page }) => {
    for (const locale of ["id", "en"]) {
      await page.goto(`/${locale}/about`);
      await expect(page.getByTestId("landing")).not.toContainText(/arjum|idx-bei|idx edge/i);
    }
  });

  test("reachable from the app", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "sidebar link is desktop/tablet");
    await page.goto("/en");
    // Checked by target, not a click: in dev, Next's corner indicator overlaps the tablet icon rail.
    await expect(page.getByTestId("nav-about")).toHaveAttribute("href", "/en/about");
  });
});
