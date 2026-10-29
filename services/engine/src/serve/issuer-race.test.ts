import { describe, expect, it } from "vitest";
import { MemoryMarketStore } from "./store";
import { serveIssuerRace } from "./issuer-race";

const day = (n: number) => `2026-01-${String(n).padStart(2, "0")}`;

describe("serveIssuerRace", () => {
  it("ranks same-sector issuers against the same baseline and reports frame coverage", async () => {
    const store = new MemoryMarketStore({
      securities: [
        { symbol: "AAA", name: "Alpha", sector: "Finance", subsector: null, board: null, sharesOutstanding: null, freeFloatPct: null, asOf: new Date(), active: true },
        { symbol: "BBB", name: "Beta", sector: "Finance", subsector: null, board: null, sharesOutstanding: null, freeFloatPct: null, asOf: new Date(), active: true },
        { symbol: "CCC", name: "Gamma", sector: "Energy", subsector: null, board: null, sharesOutstanding: null, freeFloatPct: null, asOf: new Date(), active: true },
      ],
      daily: [
        { symbol: "AAA", date: day(1), close: 100, open: null, high: null, low: null, previousClose: null, volume: null, value: null, frequency: null, foreignBuy: null, foreignSell: null },
        { symbol: "AAA", date: day(2), close: 110, open: null, high: null, low: null, previousClose: null, volume: null, value: null, frequency: null, foreignBuy: null, foreignSell: null },
        { symbol: "BBB", date: day(1), close: 200, open: null, high: null, low: null, previousClose: null, volume: null, value: null, frequency: null, foreignBuy: null, foreignSell: null },
        { symbol: "BBB", date: day(2), close: 180, open: null, high: null, low: null, previousClose: null, volume: null, value: null, frequency: null, foreignBuy: null, foreignSell: null },
        { symbol: "CCC", date: day(1), close: 50, open: null, high: null, low: null, previousClose: null, volume: null, value: null, frequency: null, foreignBuy: null, foreignSell: null },
        { symbol: "CCC", date: day(2), close: 60, open: null, high: null, low: null, previousClose: null, volume: null, value: null, frequency: null, foreignBuy: null, foreignSell: null },
      ],
    });

    const result = await serveIssuerRace(store, "1M", "Finance", new Date("2026-01-03T00:00:00Z"));
    expect(result?.data.sector).toBe("Finance");
    expect(result?.data.universe.active).toBe(2);
    const leaders = result?.data.frames.at(-1)?.leaders ?? [];
    expect(leaders.map(({ symbol }) => symbol)).toEqual(["AAA", "BBB"]);
    expect(leaders[0].returnPercent).toBeCloseTo(10);
    expect(leaders[1].returnPercent).toBeCloseTo(-10);
    expect(result?.data.frames.at(-1)?.priced).toBe(2);
  });

  it("excludes securities without an exact baseline close and reports the reduced coverage", async () => {
    const store = new MemoryMarketStore({
      securities: [
        { symbol: "AAA", name: "Alpha", sector: "Finance", subsector: null, board: null, sharesOutstanding: null, freeFloatPct: null, asOf: new Date(), active: true },
        { symbol: "BBB", name: "Baseline maker", sector: "Energy", subsector: null, board: null, sharesOutstanding: null, freeFloatPct: null, asOf: new Date(), active: true },
      ],
      daily: [
        { symbol: "BBB", date: day(1), close: 10, open: null, high: null, low: null, previousClose: null, volume: null, value: null, frequency: null, foreignBuy: null, foreignSell: null },
        { symbol: "AAA", date: day(2), close: 10, open: null, high: null, low: null, previousClose: null, volume: null, value: null, frequency: null, foreignBuy: null, foreignSell: null },
        { symbol: "BBB", date: day(2), close: 10, open: null, high: null, low: null, previousClose: null, volume: null, value: null, frequency: null, foreignBuy: null, foreignSell: null },
      ],
    });
    const result = await serveIssuerRace(store, "1M", "Finance", new Date("2026-01-03T00:00:00Z"));
    expect(result?.data.universe.active).toBe(1);
    expect(result?.data.universe.withBaseline).toBe(0);
    expect(result?.data.frames.at(-1)).toMatchObject({ priced: 0, leaders: [] });
  });
});
