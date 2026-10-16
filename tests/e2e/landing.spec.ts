import { expect, test } from "@playwright/test";

test.describe("landing page at the locale root", () => {
  test("Indonesian by default, English available; sections, CTAs and anchors", async ({ page }) => {
    await page.goto("/id");
    await expect(page.getByTestId("landing-title")).toHaveText("Riset saham BEI, tiap angka jelas tanggalnya.");
    await expect(page.getByTestId("app-shell")).toHaveCount(0);
    await expect(page.getByTestId("landing-facts").locator("dd")).toHaveCount(4);
    await expect(page.getByTestId("landing-freshness").locator("[data-freshness]")).toHaveCount(5);
    await expect(page.getByTestId("landing-freshness").locator('[data-freshness="LIVE"]')).toHaveCount(0);
    await expect(page.getByTestId("landing-faq").locator("details")).toHaveCount(6);
    // e2e runs with the dev auth bypass, so the CTA opens the app.
    await expect(page.getByTestId("landing-hero-cta").getByRole("link")).toHaveAttribute("href", "/id/dashboard");
    await page.goto("/en");
    await expect(page.getByTestId("landing-title")).toHaveText("IDX stock research, with every number dated.");
    await expect(page).toHaveTitle("HAKA PRO — IDX stock research");
  });

  test("share and alternate links are absolute and point at this origin", async ({ page, baseURL }) => {
    await page.goto("/en");
    const origin = new URL(baseURL!).origin;
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${origin}/en`);
    await expect(page.locator('link[rel="alternate"][hreflang="id"]')).toHaveAttribute("href", `${origin}/id`);
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute("href", `${origin}/id`);
    const ogImage = await page.locator('meta[property="og:image"]').first().getAttribute("content");
    expect(ogImage?.startsWith(`${origin}/`)).toBe(true);
    // The e2e server runs as the default (production) environment, so the page may be indexed.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  });

  test("no horizontal overflow at this viewport", async ({ page }) => {
    for (const locale of ["id", "en"]) {
      await page.goto(`/${locale}`);
      await expect(page.getByTestId("landing-title")).toBeVisible();
      const overflow = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const wide = [...document.querySelectorAll<HTMLElement>("[data-testid='landing'] *")]
          .filter((element) => element.getBoundingClientRect().right > width + 1 && getComputedStyle(element).position !== "fixed")
          .map((element) => element.dataset.testid || element.tagName.toLowerCase());
        return { scroll: document.scrollingElement!.scrollWidth - width, wide: wide.slice(0, 5) };
      });
      expect(overflow, `${locale}: elements wider than the viewport`).toEqual({ scroll: 0, wide: [] });
    }
  });

  test("names no data vendor", async ({ page }) => {
    for (const locale of ["id", "en"]) {
      await page.goto(`/${locale}`);
      await expect(page.getByTestId("landing")).not.toContainText(/arjum|idx-bei|idx edge/i);
    }
  });

  test("reachable from the app", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "sidebar link is desktop/tablet");
    await page.goto("/en/dashboard");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("nav-home")).toHaveAttribute("href", "/en/dashboard");
    // Checked by target, not a click: in dev, Next's corner indicator overlaps the tablet icon rail.
    await expect(page.getByTestId("nav-about")).toHaveAttribute("href", "/en");
  });
});
