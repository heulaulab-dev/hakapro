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
          var container = document.createElement("div");
          container.className = "trbtn-overlay-container " + window.__trakteerArgs[5];
          var button = document.createElement("button");
          button.setAttribute("aria-label", "Trakteer Kopi");
          button.textContent = "Trakteer Kopi";
          container.appendChild(button);
          script.parentNode.insertBefore(container, script);
          var style = document.createElement("style");
          style.textContent = ".trbtn-overlay-container.floating-right { position: fixed; bottom: 20px; right: 20px; }";
          document.head.appendChild(style);
        }
      };`,
    });
  });

  await page.goto("/en/dashboard");
  await expect(page.getByRole("button", { name: "Trakteer Kopi" })).toBeVisible();
  const placement = page.locator(".trbtn-overlay-container");
  await expect(placement).toHaveClass(/floating-right/);
  await expect(placement).toHaveCSS("position", "fixed");
  if (testInfo.project.name === "mobile") {
    await expect(placement).toHaveCSS("bottom", "72px");
    await expect(placement).toHaveCSS("right", "16px");
  } else {
    await expect(placement).toHaveCSS("bottom", "20px");
    await expect(placement).toHaveCSS("right", "20px");
  }
  const initArgs = await page.evaluate(() => (window as Window & { __trakteerArgs?: unknown[] }).__trakteerArgs);
  expect(initArgs).toEqual([
    "Trakteer Kopi",
    "#be1e2d",
    "https://trakteer.id/v1/heulaulab/tip/embed/modal",
    "https://edge-cdn.trakteer.id/images/embed/trbtn-icon.png?v=14-05-2025",
    40,
    "floating-right",
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
