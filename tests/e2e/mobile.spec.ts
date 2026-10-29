import { expect, test, type Page } from "@playwright/test";

/**
 * Mobile-first guard rails at 360x740 (the narrowest common phone) in fixture mode: nothing may scroll
 * sideways, touch targets stay usable, and the phone-specific patterns (sticky quote, cards, filter sheet)
 * work. Runs once, in the `mobile` project (the viewport is forced here, not taken from the device).
 */
test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== "mobile", "mobile only"));
test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

const ROUTES = [
  "/id", "/en", "/id/login", "/id/signup",
  "/id/dashboard", "/id/discover/screener", "/id/discover/strategies", "/id/discover/strategies/akumulasi-senyap",
  "/id/discover/heatmap", "/id/discover/groups", "/id/discover/radar", "/id/discover/stealth", "/id/discover/ownership", "/id/discover/one-percent",
  "/id/methodology", "/id/watchlist", "/id/alerts", "/id/news", "/id/discover/movers",
  "/id/stock/BBCA", "/id/stock/BBCA/chart", "/id/stock/BBCA/flow", "/id/stock/BBCA/analysis", "/id/stock/BBCA/financials",
  "/id/stock/BBCA/dividends", "/id/stock/BBCA/ownership", "/id/stock/BBCA/insiders", "/id/stock/BBCA/history", "/id/research/BBCA", "/id/zzz-not-found",
];

/** The app scrolls inside <main> (body is overflow-hidden), so the document check alone would never fail. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const width = innerWidth;
    const scrollers = [document.documentElement, ...document.querySelectorAll<HTMLElement>("main, [data-testid='marketing-scroll']")];
    const sideways = scrollers.map((element) => element.scrollWidth - element.clientWidth).filter((delta) => delta > 0);
    const clipped = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.right <= width + 1 || getComputedStyle(element).position === "fixed") return false;
        for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          if (["auto", "scroll", "hidden"].includes(getComputedStyle(parent).overflowX)) return false;
        }
        return true;
      })
      .map((element) => `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 40)}`);
    return { sideways, clipped: clipped.slice(0, 5) };
  });
}

test.describe("no horizontal overflow at 360px", () => {
  for (const route of ROUTES) {
    test(route, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      expect(await overflow(page), `${route} scrolls or clips sideways`).toEqual({ sideways: [], clipped: [] });
    });
  }
});

test("bottom nav items are at least 40px tall and the shell is not hidden behind it", async ({ page }) => {
  await page.goto("/id/dashboard");
  const nav = page.getByTestId("mobile-nav");
  await expect(nav).toBeVisible();
  for (const item of await nav.locator("a, button").all()) {
    expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  }
  const main = await page.locator("main").boundingBox();
  const bar = await nav.boundingBox();
  expect(main!.y + main!.height).toBeLessThanOrEqual(bar!.y + 1);
});

test("controls reach 40px touch targets and inputs avoid the iOS zoom (16px)", async ({ page }) => {
  await page.goto("/id/stock/BBCA/history");
  await page.waitForLoadState("networkidle");
  const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("main button:not([data-freshness]), main input, main select")]
    .filter((element) => element.getBoundingClientRect().width > 0)
    .filter((element) => { const box = element.getBoundingClientRect(); return box.height < 39.5 || box.width < 39.5; })
    .map((element) => (element.getAttribute("aria-label") ?? element.textContent ?? element.tagName).trim().slice(0, 20)));
  expect(small).toEqual([]);
  // History's date fields are DatePicker buttons now (no text input to zoom into); check a page with a real text field.
  await page.goto("/id/discover/heatmap");
  await page.waitForLoadState("networkidle");
  const fonts = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("main input:not([type=file]):not(.sr-only), main select")].map((element) => parseFloat(getComputedStyle(element).fontSize)));
  expect(fonts.length).toBeGreaterThan(0);
  expect(Math.min(...fonts)).toBeGreaterThanOrEqual(16);
});

test("stock page: price, change, turnover and volume are visible without scrolling; quote sticks under the tabs", async ({ page }) => {
  await page.goto("/id/stock/BBCA");
  const header = page.getByTestId("stock-header-symbol");
  await expect(header).toBeVisible();
  const stats = page.getByTestId("stock-header-stats");
  await expect(stats).toBeVisible();
  const box = await stats.boundingBox();
  expect(box!.y + box!.height).toBeLessThan(740 - 56);
  const sticky = page.getByTestId("stock-sticky");
  await expect(sticky).toHaveAttribute("data-collapsed", "false");
  await page.locator("main").evaluate((element) => { element.scrollTop = 600; });
  await expect(sticky).toHaveAttribute("data-collapsed", "true");
  await expect(page.getByTestId("stock-compact-quote")).toContainText("BBCA");
  // Pinned to the top of the scroll area (<main>), directly under the app header.
  const [stuck, top] = [(await sticky.boundingBox())!.y, (await page.locator("main").boundingBox())!.y];
  expect(Math.abs(stuck - top)).toBeLessThan(2);
});

test("history rows turn into cards instead of a sideways table", async ({ page }) => {
  await page.goto("/id/stock/BBCA/history");
  await expect(page.getByTestId("history-table").getByTestId("table-card").first()).toBeVisible();
  await expect(page.getByTestId("history-table").locator("table")).toHaveCount(0);
});

test("screener builder opens in a bottom sheet and runs from it", async ({ page }) => {
  await page.goto("/id/discover/screener");
  await expect(page.getByTestId("screen-builder")).toHaveCount(0);
  await page.getByTestId("screener-filters").click();
  await expect(page.getByTestId("screen-builder")).toBeVisible();
  await page.getByTestId("screen-run").click();
  await expect(page.getByTestId("screen-builder")).toHaveCount(0);
  await expect(page).toHaveURL(/[?&]c=/);
});

test("heatmap controls are one scrollable row", async ({ page }) => {
  await page.goto("/id/discover/heatmap");
  const controls = page.getByTestId("heatmap-controls");
  await expect(controls).toBeVisible();
  expect((await controls.boundingBox())!.height).toBeLessThan(70);
});
