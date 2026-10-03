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

test("freshness tooltip shows as-of and period on keyboard focus", async ({ page }) => {
  await page.goto("/en/dev/primitives");
  await page.getByTestId("panel-dark-comfortable").locator('[data-freshness="STALE"]').focus();
  const tooltip = page.getByRole("tooltip").first();
  await expect(tooltip).toContainText("Data as of Mar 31, 2026");
  await expect(tooltip).toContainText("Period Q1 2026");
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
