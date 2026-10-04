import { expect, test } from "vitest";
import { ARJUM_LIMITS } from "./provider-limits";

test("provider limits match the live arjum API (422 above these, verified 2026-10-03) and its docs (2026-10-04)", () => {
  expect(ARJUM_LIMITS).toEqual({
    insiders: 15, marketCapPerPage: 50, doneDetailsPerPage: 100, historyRows: 500, historyMinRows: 20, accumulationTop: 5,
    brokerSummaryRows: 200, marketCapCodes: 50, financialPeriods: 40,
  });
});
