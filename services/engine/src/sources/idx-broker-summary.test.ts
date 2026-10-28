import { describe, expect, it } from "vitest";
import response from "./fixtures/idx-broker-summary.2026-08-07.json";
import { idxBrokerSummaryParams, parseIdxBrokerSummary } from "./idx-broker-summary";

describe("IDX GetBrokerSummary contract", () => {
  it("normalizes date and broker transaction totals from the official envelope", () => {
    expect(idxBrokerSummaryParams("2026-08-07")).toEqual({ date: "20260807", start: 0, length: 9999 });
    const parsed = parseIdxBrokerSummary(response, "2026-08-07");
    expect(parsed.rejected).toEqual([]);
    expect(parsed.rows).toEqual([{
      date: "2026-08-07", brokerCode: "AD", firmName: "Sukadana Prima Sekuritas", volume: 35415900, value: 4351965300, frequency: 461,
    }]);
  });

  it("rejects mismatched dates, invalid codes, negative totals, and duplicate brokers", () => {
    const row = response.data[0];
    const parsed = parseIdxBrokerSummary({
      ...response, data: [
        { ...row, IDFirm: "BB", Date: "2026-08-06T00:00:00" },
        { ...row, IDFirm: " " },
        { ...row, IDFirm: "CC", Value: -1 },
        { ...row, IDFirm: "AD" },
        { ...row, IDFirm: "AD" },
      ],
    }, "2026-08-07");

    expect(parsed.rows.map((item) => item.brokerCode)).toEqual(["AD"]);
    expect(parsed.rejected.map(({ reason }) => reason)).toEqual(["date-mismatch", "invalid-broker-code", "negative-market-value", "duplicate-broker-code"]);
  });
});
