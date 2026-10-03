import { expect, test } from "vitest";
import { expectedLatestPeriodEnd, periodEnd } from "./reporting";

test("period end from provider year/quarter", () => {
  expect(periodEnd("2026", "1", "quarterly")).toBe("2026-03-31");
  expect(periodEnd("2025", "4", "quarterly")).toBe("2025-12-31");
  expect(periodEnd("2025", "", "annual")).toBe("2025-12-31");
  expect(periodEnd("2026", "5", "quarterly")).toBeNull();
  expect(periodEnd("FY26", "1", "quarterly")).toBeNull();
});

test("expected latest quarterly period uses the (unverified) 30/90-day deadlines", () => {
  expect(expectedLatestPeriodEnd("2026-10-03", "quarterly")).toBe("2026-06-30");
  expect(expectedLatestPeriodEnd("2026-10-30", "quarterly")).toBe("2026-09-30");
  // Q4 is the annual report: due 90 days after 31 Dec.
  expect(expectedLatestPeriodEnd("2026-02-15", "quarterly")).toBe("2025-09-30");
  expect(expectedLatestPeriodEnd("2026-03-31", "quarterly")).toBe("2025-12-31");
});

test("expected latest annual period", () => {
  expect(expectedLatestPeriodEnd("2026-03-30", "annual")).toBe("2024-12-31");
  expect(expectedLatestPeriodEnd("2026-03-31", "annual")).toBe("2025-12-31");
});
