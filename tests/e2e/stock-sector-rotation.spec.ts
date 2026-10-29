import { expect, test } from "@playwright/test";

const point = (date: string, rsRatio: number, rsMomentum: number, quadrant: "leading" | "weakening" | "improving" | "lagging") => ({ date, rsRatio, rsMomentum, quadrant });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/sector-rotation/stocks**", (route) => route.fulfill({ json: {
    data: {
      sector: "Energy", sectors: [{ name: "Energy", members: 15 }, { name: "Finance", members: 30 }], interval: "weekly",
      from: "2025-10-01", to: "2026-10-29", sessions: 252,
      universe: { activeMembers: 15, eligibleIssuers: 2, returnedIssuers: 2, truncated: false }, minPeerConstituents: 3, requiredObservations: 20,
      stocks: [
        { symbol: "ADRO", name: "Alamtri Resources Indonesia Tbk", peers: 14, basketCoveragePercent: 96, alignedObservations: 48, latest: point("2026-10-29", 101.4, 102.1, "leading"), points: [point("2026-10-22", 100.2, 100.7, "leading"), point("2026-10-29", 101.4, 102.1, "leading")] },
        { symbol: "MEDC", name: "Medco Energi Internasional Tbk", peers: 14, basketCoveragePercent: 90, alignedObservations: 44, latest: point("2026-10-29", 98.8, 99.3, "lagging"), points: [point("2026-10-22", 99.2, 100.1, "improving"), point("2026-10-29", 98.8, 99.3, "lagging")] },
      ],
    }, freshness: "EOD", asOf: "2026-10-29", source: "idx-bei",
  } }));
});

test("desktop: Stock Rotation is a standalone module with peer-relative RRG coverage", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop navigation flow");
  await page.goto("/en/discover/ownership");
  await expect(page.getByTestId("nav-stockRotation")).toBeVisible();
  await expect(page.getByTestId("nav-onePercent")).toBeVisible();
  await page.getByTestId("nav-stockRotation").click();
  await expect(page).toHaveURL(/\/en\/discover\/stock-rotation$/);
  await expect(page).toHaveTitle(/Stock Rotation/);

  const view = page.getByTestId("stock-sector-rotation");
  await expect(view.getByTestId("stock-sector-rotation-coverage")).toContainText("15 current sector members");
  await expect(view.getByTestId("stock-sector-rotation-chart")).toBeVisible();
  const tailControl = view.getByTestId("stock-sector-tail").getByRole("radiogroup");
  await tailControl.getByRole("radio", { name: "4" }).click();
  await expect(tailControl.getByRole("radio", { name: "4" })).toHaveAttribute("aria-checked", "true");
  await expect(view.getByTestId("stock-sector-row-ADRO")).toContainText("Basket history coverage: 96.0% of sessions");
  await expect(view.getByTestId("stock-sector-row-ADRO")).toContainText("Leading");
  await expect(view.getByTestId("stock-sector-row-MEDC")).toContainText("Lagging");
  await view.getByTestId("stock-sector-rotation-methodology").getByRole("button", { name: "Method and data limits" }).click();
  await expect(view.getByTestId("stock-sector-rotation-methodology")).toContainText("synthetic");
});

test("mobile: Stock Rotation appears in the standalone module list", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile module flow");
  await page.goto("/id/dashboard");
  await page.getByTestId("mobile-more").click();
  const modules = page.getByTestId("all-modules");
  await expect(modules.getByTestId("module-stockRotation")).toBeVisible();
  await modules.getByTestId("module-stockRotation").click();
  await expect(page).toHaveURL(/\/id\/discover\/stock-rotation$/);
  await expect(page.getByRole("heading", { level: 1, name: "Rotasi Saham" })).toBeVisible();
});
