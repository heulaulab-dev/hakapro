import { expect, test } from "@playwright/test";

test("loads the Trakteer tip overlay once with the configured HakaPro details", async ({ page }, testInfo) => {
  let scriptLoads = 0;
  await page.route("**/js/trbtn-overlay.min.js**", async (route) => {
    scriptLoads += 1;
    await route.fulfill({
      contentType: "application/javascript",
      body: `window.trbtnOverlay = {
        init: function () { window.__trakteerArgs = Array.from(arguments); return 0; },
        draw: function () {
          var script = document.querySelector("script.troverlay");
          if (!script || !script.parentNode) return;
          var button = document.createElement("button");
          button.setAttribute("aria-label", "Trakteer Kopi");
          button.textContent = "Trakteer Kopi";
          script.parentNode.insertBefore(button, script);
        }
      };`,
    });
  });

  await page.goto("/en/dashboard");
  await expect(page.getByRole("button", { name: "Trakteer Kopi" })).toBeVisible();
  const initArgs = await page.evaluate(() => (window as Window & { __trakteerArgs?: unknown[] }).__trakteerArgs);
  expect(initArgs).toEqual([
    "Trakteer Kopi",
    "#be1e2d",
    "https://trakteer.id/v1/heulaulab/tip/embed/modal",
    "https://edge-cdn.trakteer.id/images/embed/trbtn-icon.png?v=14-05-2025",
    40,
    "inline",
  ]);

  if (testInfo.project.name === "mobile") {
    await page.getByTestId("mobile-more").click();
    await page.getByTestId("all-modules").getByTestId("module-marketReplay").click();
  } else {
    await page.getByTestId("nav-marketReplay").click();
  }
  await expect(page).toHaveURL(/\/en\/discover\/market-replay$/);
  await expect(page.getByRole("button", { name: "Trakteer Kopi" })).toBeVisible();
  expect(scriptLoads).toBe(1);
});
