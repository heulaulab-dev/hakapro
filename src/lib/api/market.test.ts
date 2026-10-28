import { describe, expect, it } from "vitest";
import { indicesHistorySchema } from "./market";
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
