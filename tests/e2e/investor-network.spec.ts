import { expect, test } from "@playwright/test";

test("Investor Network is a standalone KSEI snapshot module", async ({ page }) => {
  await page.goto("/en/discover/investor-network");
  await expect(page.getByTestId("investor-network-replay")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Investor Network Replay" })).toBeVisible();
  await expect(page.getByText("No KSEI ownership snapshots have been uploaded yet.").or(page.getByText("Unsupported", { exact: false }))).toBeVisible();
});
