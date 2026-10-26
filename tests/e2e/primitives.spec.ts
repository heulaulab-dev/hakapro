import { expect, test } from "@playwright/test";

const STATES = ["LIVE", "DELAYED", "EOD", "HISTORICAL", "STALE", "UNAVAILABLE"];
const PANELS = ["dark-comfortable", "dark-compact", "light-comfortable", "light-compact"];
const LABELS = {
  id: ["Real-time", "Tertunda", "Penutupan", "Historis", "Usang", "Tidak tersedia"],
  en: ["Live", "Delayed", "End of day", "Historical", "Stale", "Unavailable"],
} as const;

for (const locale of ["id", "en"] as const) {
  test(`primitives (${locale}): every freshness state in both themes and densities`, async ({ page }) => {
    await page.goto(`/${locale}/dev/primitives`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    for (const panel of PANELS) {
      const section = page.getByTestId(`panel-${panel}`);
      await expect(section).toHaveClass(new RegExp(panel.split("-")[0]));
      await expect(section).toHaveAttribute("data-density", panel.split("-")[1]);
      for (const [index, state] of STATES.entries()) {
        await expect(section.locator(`[data-freshness="${state}"]`)).toHaveText(LABELS[locale][index]);
      }
    }
  });
}

test("freshness details show as-of and period (tooltip on keyboard focus; tap popover on touch)", async ({ page, hasTouch }) => {
  await page.goto("/en/dev/primitives");
  const badge = page.getByTestId("panel-dark-comfortable").locator('[data-freshness="STALE"]');
  // Hover tooltips never open on touch screens, so touch devices get the same details in a popover.
  if (hasTouch) {
    await expect(badge).toHaveJSProperty("tagName", "BUTTON"); // swapped in after hydration
    await badge.click();
  }
  else await badge.focus();
  const details = page.getByRole(hasTouch ? "dialog" : "tooltip").first();
  await expect(details).toContainText("Data as of Mar 31, 2026");
  await expect(details).toContainText("Period Q1 2026");
});

test("compact density rows are shorter than comfortable rows", async ({ page }) => {
  await page.goto("/id/dev/primitives");
  const row = (panel: string) => page.getByTestId(`panel-${panel}`).locator("tbody tr").first().boundingBox();
  const [comfortable, compact] = await Promise.all([row("dark-comfortable"), row("dark-compact")]);
  expect(compact!.height).toBeLessThan(comfortable!.height);
});

test("root redirects to the default locale (id)", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/id$/);
});
