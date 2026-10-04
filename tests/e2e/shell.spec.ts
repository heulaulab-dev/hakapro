import { expect, test, type Page } from "@playwright/test";

const only = (project: string) =>
  test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== project, `${project} only`));

async function openPaletteWithKeyboard(page: Page) {
  await page.locator("body").click({ position: { x: 5, y: 200 } });
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("palette-input")).toBeVisible();
}

test.describe("desktop", () => {
  only("desktop");

  test("sidebar shows the four destinations with Discover sub-pages, labelled", async ({ page }) => {
    await page.goto("/id/dashboard");
    const sidebar = page.getByTestId("app-sidebar");
    await expect(sidebar).toBeVisible();
    for (const label of ["Beranda", "Screener", "Strategi", "Penggerak Pasar", "Perubahan Kepemilikan", "Daftar Pantau", "Berita & Kalender"]) {
      await expect(sidebar.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(page.getByTestId("mobile-nav")).toBeHidden();
  });

  test("sidebar navigation marks the active page", async ({ page }) => {
    await page.goto("/en/dashboard");
    await page.getByTestId("nav-strategies").click();
    await expect(page).toHaveURL(/\/en\/discover\/strategies$/);
    await expect(page.getByTestId("nav-strategies")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1, name: "Strategies" })).toBeVisible();
  });

  test("Ctrl+K searches stocks and opens the stock page", async ({ page }) => {
    await page.goto("/id/dashboard");
    await openPaletteWithKeyboard(page);
    await page.getByTestId("palette-input").fill("bbca");
    await page.getByTestId("palette-stock-BBCA").click();
    await expect(page).toHaveURL(/\/id\/stock\/BBCA$/);
    await expect(page.getByTestId("stock-symbol")).toHaveText("BBCA");
  });

  test("palette jumps to a stock tab and to any page", async ({ page }) => {
    await page.goto("/en/stock/BBCA");
    await page.getByTestId("header-search").click();
    await page.getByTestId("palette-input").fill("BBCA Financials");
    await page.getByRole("option", { name: /Financials/ }).first().click();
    await expect(page).toHaveURL(/\/en\/stock\/BBCA\/financials$/);
    await openPaletteWithKeyboard(page);
    await page.getByTestId("palette-input").fill("watchlist");
    await page.getByTestId("palette-page-watchlist").click();
    await expect(page).toHaveURL(/\/en\/watchlist$/);
  });

  test("saved screens ask the viewer to sign in when there is no session", async ({ page }) => {
    await page.goto("/en/dashboard");
    await openPaletteWithKeyboard(page);
    await expect(page.getByText("Sign in to see saved screens.")).toBeVisible();
  });

  test("locale switch keeps the current page", async ({ page }) => {
    await page.goto("/id/stock/BBCA/chart");
    await expect(page.getByTestId("stock-tab-chart")).toHaveAccessibleName("Grafik");
    await page.getByTestId("locale-switch").click();
    await page.getByTestId("locale-en").click();
    await expect(page).toHaveURL(/\/en\/stock\/BBCA\/chart$/);
    await expect(page.getByTestId("stock-tab-chart")).toHaveAccessibleName("Chart");
  });

  test("theme and density switches apply immediately and persist", async ({ page }) => {
    await page.goto("/en/dashboard");
    const html = page.locator("html");
    await expect(html).toHaveClass(/\bdark\b/);
    await expect(html).toHaveAttribute("data-density", "comfortable");
    await page.getByTestId("theme-toggle").click();
    await page.getByTestId("density-toggle").click();
    await expect(html).toHaveClass(/\blight\b/);
    await expect(html).toHaveAttribute("data-density", "compact");
    await page.reload();
    await expect(html).toHaveClass(/\blight\b/);
    await expect(html).toHaveAttribute("data-density", "compact");
  });

  test("tickers are canonicalised; invalid tickers 404", async ({ page }) => {
    await page.goto("/id/stock/bbca");
    await expect(page).toHaveURL(/\/id\/stock\/BBCA$/);
    const response = await page.goto("/id/stock/BB-CA");
    expect(response?.status()).toBe(404);
  });
});

test.describe("tablet", () => {
  only("tablet");

  test("icon rail with hidden labels, header controls, no bottom nav", async ({ page }) => {
    await page.goto("/en/dashboard");
    const sidebar = page.getByTestId("app-sidebar");
    await expect(sidebar).toBeVisible();
    expect((await sidebar.boundingBox())!.width).toBeLessThan(80);
    await expect(sidebar.getByRole("link", { name: "Watchlist" })).toBeVisible(); // accessible name stays
    await expect(page.getByTestId("header-search")).toBeVisible();
    await expect(page.getByTestId("theme-toggle")).toBeVisible();
    await expect(page.getByTestId("mobile-nav")).toBeHidden();
  });
});

test.describe("mobile", () => {
  only("mobile");

  test("own hierarchy: bottom nav, no sidebar, no desktop search box", async ({ page }) => {
    await page.goto("/id/dashboard");
    await expect(page.getByTestId("mobile-nav")).toBeVisible();
    await expect(page.getByTestId("app-sidebar")).toBeHidden();
    await expect(page.getByTestId("header-search")).toBeHidden();
    for (const label of ["Beranda", "Cari", "Daftar Pantau", "Lainnya"]) {
      await expect(page.getByTestId("mobile-nav").getByText(label)).toBeVisible();
    }
  });

  test("Search opens the palette; More holds Discover, News and display settings", async ({ page }) => {
    await page.goto("/en/dashboard");
    await page.getByTestId("mobile-search").click();
    await expect(page.getByTestId("palette-input")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("mobile-more").click();
    const sheet = page.getByRole("dialog");
    for (const label of ["Screener", "Strategies", "Movers", "Ownership Changes", "News & Calendar", "Alerts"]) {
      await expect(sheet.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(sheet.getByTestId("theme-toggle")).toBeVisible();
    await sheet.getByRole("link", { name: "Movers" }).click();
    await expect(page).toHaveURL(/\/en\/discover\/movers$/);
  });
});
