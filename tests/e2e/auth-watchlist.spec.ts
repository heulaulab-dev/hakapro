import { expect, test } from "@playwright/test";

// The e2e server runs with DEV_AUTH_BYPASS=1 and no Better Auth/SMTP settings, so every auth page
// explains why sign-in is off and renders no email/password form (it needs SMTP, see README).
test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name === "tablet", "desktop + mobile"));

test("auth pages are localized and explain that auth is off under the dev bypass", async ({ page }) => {
  await page.goto("/id/login");
  await expect(page.getByRole("heading", { level: 1, name: "Masuk" })).toBeVisible();
  await expect(page.getByTestId("auth-disabled")).toContainText("DEV_AUTH_BYPASS");
  await expect(page.getByTestId("auth-submit")).toHaveCount(0);
  await page.goto("/id/signup");
  await expect(page.getByTestId("auth-signup").getByTestId("auth-disabled")).toBeVisible();
  await page.goto("/en/forgot-password");
  await expect(page.getByRole("heading", { level: 1, name: "Forgot password" })).toBeVisible();
  await page.goto("/en/reset-password");
  await expect(page.getByTestId("auth-reset").getByTestId("auth-disabled")).toBeVisible();
});

test("callback errors are shown in plain language", async ({ page }) => {
  await page.goto("/en/login?error=auth");
  await expect(page.getByTestId("auth-error")).toHaveText("The sign-in link is invalid or has expired.");
});

test("watchlist asks for a signed-in user; the account menu sign-in no longer 404s", async ({ page }) => {
  await page.goto("/en/watchlist");
  await expect(page.getByRole("heading", { level: 1, name: "Watchlist" })).toBeVisible();
  await expect(page.getByText("Sign in to create and see your watchlist.")).toBeVisible();
  const response = await page.goto("/en/login");
  expect(response?.status()).toBe(200);
});

test("quotes API: per-symbol results, validation", async ({ request }) => {
  const ok = await (await request.get("/api/quotes?symbols=BBCA,SOCI,BBCA")).json();
  expect(ok.data).toHaveLength(2);
  expect(ok.data[0]).toMatchObject({ symbol: "BBCA", status: "ok", close: 6300, freshness: "HISTORICAL" });
  expect(ok.data[1]).toEqual({ symbol: "SOCI", status: "error", error: "NOT_RECORDED" });
  expect((await request.get("/api/quotes?symbols=BB-CA")).status()).toBe(400);
  const tooMany = Array.from({ length: 31 }, (_, index) => `S${index}`).join(",");
  expect((await request.get(`/api/quotes?symbols=${tooMany}`)).status()).toBe(400);
});
