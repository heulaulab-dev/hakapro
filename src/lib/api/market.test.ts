import { describe, expect, it } from "vitest";
import { indicesHistorySchema, marketBrokerSummarySchema } from "./market";
import { brokerDirectorySchema } from "./market";

describe("indicesHistorySchema", () => {
  it("preserves engine coverage for IDX sector history", () => {
    const result = indicesHistorySchema.parse({
      series: [{ code: "IDXNONCYC", name: null, points: [{ date: "2026-10-26", close: 618.123 }] }],
      coverage: [{
        code: "IDXNONCYC", name: null, count: 1, firstDate: "2026-10-26", lastDate: "2026-10-26",
        spanTradingDays: 1, missingSessions: 0, staleTradingDays: 0, flags: [],
      }],
    });

    expect(result.coverage?.[0]).toMatchObject({ code: "IDXNONCYC", count: 1, lastDate: "2026-10-26" });
  });
});

describe("brokerDirectorySchema", () => {
  it("keeps IDX member licenses as directory metadata", () => {
    expect(brokerDirectorySchema.parse({ brokers: [{ code: "XC", name: "AJAIB SEKURITAS ASIA", license: "Broker-dealer" }] })).toEqual({
      brokers: [{ code: "XC", name: "AJAIB SEKURITAS ASIA", license: "Broker-dealer" }],
    });
  });
});

describe("marketBrokerSummarySchema", () => {
  it("accepts older Engine responses and nullable reported totals", () => {
    const result = marketBrokerSummarySchema.parse({ dates: [{ date: "2026-10-30", brokers: [{ code: "YP", name: null, value: null, volume: null, frequency: null }] }] });
    expect(result.coverage).toBeUndefined();
    expect(result.dates[0]?.brokers[0]?.value).toBeNull();
  });

  it("parses the additive session coverage response", () => {
    const result = marketBrokerSummarySchema.parse({
      dates: [{ date: "2026-10-30", rowCount: 1, brokers: [{ code: "YP", name: "Yapindo", value: 100, volume: 2, frequency: 3 }] }],
      coverage: { expectedDates: ["2026-10-30", "2026-10-31"], reportedSessions: 1, missingDates: ["2026-10-31"] },
    });
    expect(result.coverage?.missingDates).toEqual(["2026-10-31"]);
  });
});
