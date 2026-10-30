import { expect, test } from "@playwright/test";

function replayFixture(options: { comparedIssuers?: number; comparisonStatus?: "COMPARED" | "NO_PREVIOUS" } = {}) {
  const rows = Array.from({ length: 1_105 }, (_, index) => ({
    symbol: index % 2 ? "BBRI" : "BBCA", issuerName: index % 2 ? "Bank Rakyat Indonesia" : "Bank Central Asia",
    holderName: `Holder ${String(index + 1).padStart(4, "0")}`, holderKind: "organisation" as const,
    investorType: "CP", localForeign: "LOCAL", shares: String(10_000 + index), percent: "1.250000", reference: `upload:test#${index + 1}`,
  }));
  return {
    availability: "ENABLED", months: ["2026-09", "2026-08"], month: "2026-09", snapshotDate: "2026-09-30", issuers: 2, holdings: rows.length,
    issuerRecords: [
      { symbol: "BBCA", issuerName: "Bank Central Asia", snapshotDate: "2026-09-01", dataset: "KSEI", reference: "upload:a", retrievedAt: "2026-09-05T00:00:00Z", rowCount: 553, thresholdPercent: "1.000000" },
      { symbol: "BBRI", issuerName: "Bank Rakyat Indonesia", snapshotDate: "2026-09-30", dataset: "KSEI", reference: "upload:b", retrievedAt: "2026-10-04T00:00:00Z", rowCount: 552, thresholdPercent: "1.000000" },
    ], rows,
    network: { nodes: [{ id: "holder:test", label: "Example Group", kind: "holder" }, { id: "issuer:BBCA", label: "Bank Central Asia", kind: "issuer" }], edges: [{ from: "holder:test", to: "issuer:BBCA", percent: "2.000000", shares: "20000", month: "2026-09", sourceReference: "upload:a#row1", confidence: "exact" }], ambiguous: 1 },
    comparison: {
      status: options.comparisonStatus ?? "COMPARED", fromMonth: "2026-08", comparedIssuers: options.comparedIssuers ?? 1,
      statusCounts: options.comparedIssuers === 0 && options.comparisonStatus === "NO_PREVIOUS"
        ? { COMPARED: 0, NO_PREVIOUS: 2, NOT_ADJACENT: 0, REFUSED: 0 }
        : { COMPARED: options.comparedIssuers ?? 1, NO_PREVIOUS: 0, NOT_ADJACENT: 0, REFUSED: 1 },
      counts: { NEW: 0, INCREASE: 0, DECREASE: 0, EXIT: 0, UNCHANGED: 0, BELOW_THRESHOLD: 0, AMBIGUOUS: 0 },
    },
  };
}

async function useReplayFixture(page: import("@playwright/test").Page, data: ReturnType<typeof replayFixture>) {
  await page.route("**/api/ownership/network**", (route) => route.fulfill({ json: { data, freshness: "HISTORICAL", asOf: "2026-09-30", source: "idx-bei" } }));
}

test("Investor Network is a standalone KSEI snapshot module", async ({ page }) => {
  await page.goto("/en/discover/investor-network");
  await expect(page.getByTestId("investor-network-replay")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Investor Network Replay" })).toBeVisible();
  await expect(page.getByText("No KSEI ownership snapshots have been uploaded yet.").or(page.getByText("Unsupported", { exact: false }))).toBeVisible();
});

test("Indonesian navigation has its own localized module label", async ({ page }) => {
  await page.goto("/id/discover/investor-network");
  await expect(page.getByRole("heading", { name: "Jaringan Investor" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Jaringan Investor" }).first()).toBeVisible();
});

test("mixed snapshot dates, comparison coverage, and all rows remain browsable", async ({ page }) => {
  await useReplayFixture(page, replayFixture());
  await page.goto("/en/discover/investor-network");
  await expect(page.getByText(/Issuer dates vary/)).toBeVisible();
  await expect(page.getByText("Sep 1, 2026").first()).toBeVisible();
  await expect(page.getByText("Not comparable: 1")).toBeVisible();
  await expect(page.getByText("Showing 1–100 of 1,105 rows")).toBeVisible();
  await page.getByText("Browse graph links and source dates").click();
  await expect(page.getByRole("link", { name: /Example Group → BBCA/ })).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Showing 101–200 of 1,105 rows")).toBeVisible();
  await expect(page.getByText("Holder 0101")).toBeVisible();
  await expect(page.getByRole("row", { name: /BBRI/ }).first()).toBeVisible();
  for (let index = 0; index < 10; index += 1) await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Showing 1,101–1,105 of 1,105 rows")).toBeVisible();
  await expect(page.getByText("Holder 1105")).toBeVisible();
  await page.getByLabel("Sort rows by").click();
  await page.getByRole("option", { name: "Issuer" }).click();
  await expect(page.getByRole("row", { name: /BBRI/ })).toHaveCount(0);
});

test("uncompared snapshots do not present zero counts as observed change", async ({ page }) => {
  await useReplayFixture(page, replayFixture({ comparedIssuers: 0, comparisonStatus: "NO_PREVIOUS" }));
  await page.goto("/en/discover/investor-network");
  await expect(page.getByText("No earlier snapshot is available.")).toBeVisible();
  await expect(page.getByText("2 issuers have no valid comparison.")).toBeVisible();
  await expect(page.getByText("NEW", { exact: true })).toHaveCount(0);
});
