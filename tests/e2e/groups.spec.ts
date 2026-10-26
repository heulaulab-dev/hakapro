import { expect, test } from "@playwright/test";

test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== "desktop", "desktop only"));

test.describe("conglomerate groups", () => {
  test("fixture mode has no Data Engine: the page says UNSUPPORTED for every window, never invented figures", async ({ page }) => {
    await page.goto("/id/discover/groups");
    const view = page.getByTestId("groups-view");
    await expect(view.getByRole("heading", { level: 1 })).toHaveText("Grup Konglomerat");
    await expect(view.getByTestId("data-state-code")).toHaveText("UNSUPPORTED");
    await expect(view.getByTestId("groups-list")).toHaveCount(0);
    await expect(view.getByTestId("research-disclaimer")).toBeVisible();

    await view.getByTestId("groups-window-5D").click();
    await expect(page).toHaveURL(/[?&]window=5D/);
    await expect(view.getByTestId("data-state-code")).toHaveText("UNSUPPORTED");
    await expect(view.getByTestId("groups-window-5D")).toHaveAttribute("data-state", "on");
  });

  test("listed in the Discover navigation (en)", async ({ page }) => {
    await page.goto("/en/discover/movers");
    await expect(page.getByTestId("app-sidebar").getByRole("link", { name: "Conglomerate Groups" })).toHaveAttribute("href", "/en/discover/groups");
    await page.goto("/en/discover/groups");
    await expect(page.getByTestId("groups-view").getByRole("heading", { level: 1 })).toHaveText("Conglomerate Groups");
  });

  test("the API route answers the typed UNSUPPORTED error and rejects an unknown window", async ({ request }) => {
    const ok = await request.get("/api/groups?window=20D");
    expect(ok.status()).toBe(503);
    expect(await ok.json()).toMatchObject({ error: "UNSUPPORTED", data: null });
    expect((await request.get("/api/groups?window=1W")).status()).toBe(400);
  });
});
