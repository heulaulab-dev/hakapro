import { describe, expect, it } from "vitest";
import { serveBreadth } from "./breadth";
import { MemoryMarketStore } from "./store";

describe("market breadth", () => {
  it("classifies strong participation as risk on", async () => {
    const result = await serveBreadth(new MemoryMarketStore({ daily: [
      { symbol: "A", date: "2026-10-28", close: 110, previousClose: 100, open: null, high: null, low: null, volume: null, value: null, frequency: null, foreignBuy: null, foreignSell: null },
      { symbol: "B", date: "2026-10-28", close: 120, previousClose: 100, open: null, high: null, low: null, volume: null, value: null, frequency: null, foreignBuy: null, foreignSell: null },
      { symbol: "C", date: "2026-10-28", close: 90, previousClose: 100, open: null, high: null, low: null, volume: null, value: null, frequency: null, foreignBuy: null, foreignSell: null },
    ] }), new Date("2026-10-29T00:00:00Z"));
    expect(result.data).toMatchObject({ advancers: 2, decliners: 1, unchanged: 0, regime: "RISK_ON", snapshotDate: "2026-10-28" });
  });
  it("does not fabricate a regime without a session", async () => {
    const result = await serveBreadth(new MemoryMarketStore(), new Date("2026-10-29T00:00:00Z"));
    expect(result.data.regime).toBe("UNAVAILABLE");
    expect(result.freshness).toBe("UNAVAILABLE");
  });
});
