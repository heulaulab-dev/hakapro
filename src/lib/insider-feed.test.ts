import { describe, expect, it } from "vitest";
import type { RecentInsider } from "@/lib/api/market";
import { topInsiderBuys } from "./insider-feed";

const row = (symbol: string, action: RecentInsider["action"], valueIdr: number | null, date = "2026-10-15"): RecentInsider => ({
  symbol, person: `${symbol} person`, date, action, nationality: "local", roles: [], broker: null,
  previousShares: null, currentShares: null, changeShares: 1, previousPercent: null, currentPercent: null, changePercent: null, priceIdr: valueIdr, valueIdr,
});

describe("topInsiderBuys", () => {
  it("ranks purchases by value, leaves out sells and purchases without a value, and caps the count", () => {
    const rows = [row("AAAA", "BUY", 5), row("BBBB", "SELL", 900), row("CCCC", "BUY", null), row("DDDD", "BUY", 50), row("EEEE", "BUY", 50, "2026-10-16"), row("FFFF", "CROSS", 70)];
    expect(topInsiderBuys(rows, 8).map((r) => r.symbol)).toEqual(["EEEE", "DDDD", "AAAA"]);
    expect(topInsiderBuys(rows, 1).map((r) => r.symbol)).toEqual(["EEEE"]);
    expect(topInsiderBuys([], 8)).toEqual([]);
  });
});
