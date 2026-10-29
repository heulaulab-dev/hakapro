import { describe, expect, it } from "vitest";
import { brokerActivityRange, deriveBrokerActivity } from "./broker-activity";
import type { MarketBrokerSummary } from "./api/market";

describe("brokerActivityRange", () => {
  it("returns a bounded inclusive calendar window", () => {
    expect(brokerActivityRange("1M", "2026-10-30")).toEqual({ from: "2026-10-01", to: "2026-10-30" });
    expect(brokerActivityRange("1Y", "2026-10-30").from).toBe("2025-10-31");
  });
});

describe("deriveBrokerActivity", () => {
  const sample: MarketBrokerSummary = {
    dates: [
      { date: "2026-10-28", rowCount: 2, brokers: [
        { code: "YP", name: "Yapindo", value: 75, volume: 5, frequency: 10 },
        { code: "AD", name: "Ajaib", value: 25, volume: 3, frequency: 6 },
      ] },
      { date: "2026-10-30", rowCount: 2, brokers: [
        { code: "YP", name: "Yapindo", value: 40, volume: 2, frequency: 8 },
        { code: "CC", name: "Mandiri", value: 60, volume: 4, frequency: 9 },
      ] },
    ],
    coverage: { expectedDates: ["2026-10-28", "2026-10-29", "2026-10-30"], reportedSessions: 2, missingDates: ["2026-10-29"] },
  };

  it("computes reported value shares and keeps missing dates as gaps", () => {
    const result = deriveBrokerActivity(sample);
    expect(result.race.map((day) => day.date)).toEqual(sample.coverage?.expectedDates);
    expect(result.race[0]?.shares).toEqual([75, null, 25]);
    expect(result.race[1]?.shares).toEqual([null, null, null]);
    expect(result.race[2]?.shares).toEqual([40, 60, null]);
    expect(result.missingDates).toEqual(["2026-10-29"]);
  });

  it("computes concentration only when the session is not capped", () => {
    const result = deriveBrokerActivity(sample);
    expect(result.latestTopFiveSharePercent).toBe(100);
    expect(result.latestHhi).toBe(5_200);

    const capped = deriveBrokerActivity({ dates: [{ date: "2026-10-30", rowCount: 100, brokers: sample.dates[1]!.brokers }], coverage: sample.coverage });
    expect(capped.latestTopFiveSharePercent).toBeNull();
    expect(capped.latestHhi).toBeNull();
  });

  it("does not invent shares for a zero-value day and accepts old Engine responses without coverage", () => {
    const oldEngine = { dates: [{ date: "2026-10-30", brokers: [{ code: "YP", name: null, value: 0, volume: 0, frequency: 0 }] }] } as MarketBrokerSummary;
    const result = deriveBrokerActivity(oldEngine);
    expect(result.reportedSessions).toBeNull();
    expect(result.expectedDates).toEqual(["2026-10-30"]);
    expect(result.rows[0]?.sharePercent).toBeNull();
    expect(result.concentration[0]).toMatchObject({ topFiveSharePercent: null, hhi: null });
  });
});
