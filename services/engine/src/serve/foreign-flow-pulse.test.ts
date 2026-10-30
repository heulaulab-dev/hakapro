import { describe, expect, it } from "vitest";
import { wib } from "../../test/support";
import { serveForeignFlowPulse } from "./foreign-flow-pulse";
import { MemoryMarketStore, type DailyRecord } from "./store";

const close = (symbol: string, date: string, value: number, foreignBuy: number | null, foreignSell: number | null): DailyRecord => ({
  symbol, date, open: value, high: value, low: value, close: value, previousClose: value, volume: 1000, value: 2_000_000_000,
  frequency: 10, foreignBuy, foreignSell,
});

describe("foreign-flow pulse", () => {
  it("reports measured sample coverage and prices net shares at the close estimate", async () => {
    const rows = [
      close("AAAA", "2026-10-15", 900, 10, 9), close("BBBB", "2026-10-15", 1500, null, null), close("CCCC", "2026-10-15", 2000, 5, 7),
      close("AAAA", "2026-10-16", 950, 10, 10), close("BBBB", "2026-10-16", 1500, 4, 4), close("CCCC", "2026-10-16", 1900, 10, 5),
      close("AAAA", "2026-10-19", 1000, 15, 10), close("BBBB", "2026-10-19", 1500, null, null), close("CCCC", "2026-10-19", 2000, 1, 5),
      close("DDDD", "2026-10-19", 1000, 100, 0),
    ];
    const store = new MemoryMarketStore({
      daily: rows,
      securities: [
        { symbol: "AAAA", name: "Alpha", sector: "Finance", subsector: null, board: null, sharesOutstanding: null, freeFloatPct: null, asOf: wib("2026-10-19", "16:35"), active: true },
        { symbol: "BBBB", name: "Beta", sector: "Finance", subsector: null, board: null, sharesOutstanding: null, freeFloatPct: null, asOf: wib("2026-10-19", "16:35"), active: true },
        { symbol: "CCCC", name: "Gamma", sector: "Energy", subsector: null, board: null, sharesOutstanding: null, freeFloatPct: null, asOf: wib("2026-10-19", "16:35"), active: true },
        { symbol: "DDDD", name: "Delisted", sector: "Energy", subsector: null, board: null, sharesOutstanding: null, freeFloatPct: null, asOf: wib("2026-10-19", "16:35"), active: false },
      ],
    });

    const served = await serveForeignFlowPulse(store, new Date("2026-10-19T15:00:00.000Z"));

    expect(served).toMatchObject({ dataAsOf: "2026-10-19", data: {
      coverage: { priced: 3, observed: 2, ratio: 2 / 3 },
      totals: { netBuyers: 1, netSellers: 1, unchanged: 0, netShares: 1, netValueIdrEstimate: -3000 },
      sectors: [
        { sector: "Energy", priced: 1, observed: 1, netShares: -4, netValueIdrEstimate: -8000 },
        { sector: "Finance", priced: 2, observed: 1, netShares: 5, netValueIdrEstimate: 5000 },
      ],
      history: [
        { date: "2026-10-15", observed: 2, priced: 3 },
        { date: "2026-10-16", observed: 3, priced: 3 },
        { date: "2026-10-19", observed: 2, priced: 3 },
      ],
    } });
  });

  it("returns no pulse if the Engine has no foreign-flow dates", async () => {
    expect(await serveForeignFlowPulse(new MemoryMarketStore(), new Date("2026-10-19T15:00:00.000Z"))).toBeNull();
  });
});
