// /v1/stocks/{s}/fundamentals and the screener's condition evaluation, over the in-memory store.
import { describe, expect, it } from "vitest";
import { conditionHolds, matchesConditions, pickRatio, serveFundamentals, serveScreener, type ScreenValues } from "./fundamentals";
import { MemoryMarketStore, type DailyRecord, type RatioRecord } from "./store";

const values = (overrides: Partial<ScreenValues>): ScreenValues => ({
  price: null, volume: null, value: null, frequency: null, foreignNetShares: null, foreignNetValue: null, marketCap: null, per: null, pbv: null, roe: null, roa: null,
  eps: null, der: null, dividendYield: null, change1D: null, ...overrides,
});
const cond = (field: keyof ScreenValues, operator: "GT" | "GTE" | "LT" | "LTE" | "EQ", value: number, connective: "AND" | "OR" = "AND") => ({ field, operator, value, connective });

describe("screener conditions", () => {
  it("compares with each operator; a null value never matches", () => {
    expect(conditionHolds({ operator: "GT", value: 10 }, 11)).toBe(true);
    expect(conditionHolds({ operator: "GT", value: 10 }, 10)).toBe(false);
    expect(conditionHolds({ operator: "GTE", value: 10 }, 10)).toBe(true);
    expect(conditionHolds({ operator: "LT", value: 10 }, 9.99)).toBe(true);
    expect(conditionHolds({ operator: "LTE", value: 10 }, 10)).toBe(true);
    expect(conditionHolds({ operator: "EQ", value: 0.3 }, 0.1 + 0.2)).toBe(true);
    expect(conditionHolds({ operator: "EQ", value: 5225 }, 5250)).toBe(false);
    for (const operator of ["GT", "GTE", "LT", "LTE", "EQ"] as const) expect(conditionHolds({ operator, value: 0 }, null)).toBe(false);
    expect(conditionHolds({ operator: "LT", value: 0 }, Number.NaN)).toBe(false);
  });

  it("binds AND tighter than OR and ignores the first connective", () => {
    const row = values({ per: 8, roe: 0.25, price: 5000, value: 1e9 });
    // (per < 10 AND roe > 0.3) OR (price > 1000 AND value > 1e10) → false OR false
    expect(matchesConditions([cond("per", "LT", 10), cond("roe", "GT", 0.3), cond("price", "GT", 1000, "OR"), cond("value", "GT", 1e10)], row)).toBe(false);
    // (per < 10 AND roe > 0.2) OR (…false…) → true
    expect(matchesConditions([cond("per", "LT", 10), cond("roe", "GT", 0.2), cond("price", "GT", 1000, "OR"), cond("value", "GT", 1e10)], row)).toBe(true);
    // per > 10 OR price > 1000 AND value > 1e8 → false OR (true AND true)
    expect(matchesConditions([cond("per", "GT", 10, "OR"), cond("price", "GT", 1000, "OR"), cond("value", "GT", 1e8)], row)).toBe(true);
    // per < 10 OR price > 1e6 AND value > 1e10: precedence gives true OR (false AND false) = true, where a
    // left-to-right reading would give (true OR false) AND false = false.
    expect(matchesConditions([cond("per", "LT", 10), cond("price", "GT", 1e6, "OR"), cond("value", "GT", 1e10)], row)).toBe(true);
    // A condition on a missing field fails its group only.
    expect(matchesConditions([cond("dividendYield", "GTE", 0), cond("price", "GT", 1000, "OR")], row)).toBe(true);
    expect(matchesConditions([cond("dividendYield", "GTE", 0)], row)).toBe(false);
    expect(matchesConditions([], row)).toBe(true);
  });

  it("prefers a derived ratio, even a deliberate null, over Pasardana's", () => {
    const pasardana: RatioRecord = { symbol: "GOTO", ratio: "per", ratioSource: "pasardana", value: -40, date: "2026-10-15" };
    const derived: RatioRecord = { symbol: "GOTO", ratio: "per", ratioSource: "derived", value: null, date: "2026-10-16" };
    expect(pickRatio([pasardana, derived])).toBe(derived);
    expect(pickRatio([pasardana])).toBe(pasardana);
    expect(pickRatio([])).toBeNull();
  });
});

const asOf = new Date("2026-10-16T12:00:00Z");
const day = (symbol: string, close: number, previousClose: number | null, value: number | null, extra: Partial<DailyRecord> = {}): DailyRecord => ({
  symbol, date: "2026-10-16", open: close, high: close, low: close, close, previousClose, volume: 1_000, value, frequency: null, foreignBuy: null, foreignSell: null, ...extra,
});
const store = () => new MemoryMarketStore({
  securities: [
    { symbol: "BBCA", name: "Bank Central Asia Tbk", sector: null, subsector: null, board: null, sharesOutstanding: 123_275_050_000, freeFloatPct: 40, asOf },
    { symbol: "GOTO", name: "GoTo Gojek Tokopedia Tbk", sector: null, subsector: null, board: null, sharesOutstanding: null, freeFloatPct: null, asOf, marketCap: 64e12 },
    { symbol: "AADI", name: "Adaro Andalan Indonesia Tbk.", sector: null, subsector: null, board: null, sharesOutstanding: 7_786_891_760, freeFloatPct: 18.18, asOf },
  ],
  daily: [
    { ...day("BBCA", 6075, 6125, 820e9), date: "2026-10-15" },
    day("BBCA", 5225, 6075, 5_196_076_490_000, { foreignBuy: 310e6, foreignSell: 420e6, frequency: 154_210 }),
    day("GOTO", 60, 64, 532e9),
    day("AADI", 11300, null, null),
  ],
  ratios: [
    { symbol: "BBCA", ratio: "per", ratioSource: "derived", value: 11.06, date: "2026-10-16" },
    { symbol: "BBCA", ratio: "per", ratioSource: "pasardana", value: 12.5, date: "2026-10-15" },
    { symbol: "BBCA", ratio: "roe", ratioSource: "derived", value: 0.2147, date: "2026-10-16" },
    { symbol: "GOTO", ratio: "per", ratioSource: "derived", value: null, date: "2026-10-16" },
    { symbol: "GOTO", ratio: "per", ratioSource: "pasardana", value: -40, date: "2026-10-15" },
    { symbol: "AADI", ratio: "per", ratioSource: "pasardana", value: 6.17137, date: "2026-10-15" },
    { symbol: "AADI", ratio: "roe", ratioSource: "pasardana", value: 0.2408, date: "2026-10-15" },
  ],
  fundamentals: [
    { symbol: "BBCA", periodEnd: "2026-06-30", periodType: "quarterly", metric: "netIncome", value: 14_850_323e6, unit: "amount", currency: "IDR", source: "yahoo-fundamentals" },
    { symbol: "BBCA", periodEnd: "2026-06-30", periodType: "quarterly", metric: "sharesOutstanding", value: 122_841_751_300, unit: "shares", currency: null, source: "yahoo-fundamentals" },
    { symbol: "BBCA", periodEnd: "2025-12-31", periodType: "annual", metric: "epsDiluted", value: 467, unit: "per_share", currency: "IDR", source: "yahoo-fundamentals" },
    { symbol: "BBCA", periodEnd: "2025-12-31", periodType: "quarterly", metric: "netIncome", value: 14_139_872e6, unit: "amount", currency: "IDR", source: "yahoo-fundamentals" },
    { symbol: "BBCA", periodEnd: "2025-12-31", periodType: "annual", metric: "netIncome", value: 57_537_287e6, unit: "amount", currency: "IDR", source: "yahoo-fundamentals" },
  ],
});

describe("serveScreener", () => {
  const now = new Date("2026-10-16T11:00:00Z");

  it("screens the newest session with ratios by precedence, nulls for gaps and the ratio source per field", async () => {
    const served = (await serveScreener(store(), { conditions: [cond("price", "GT", 0)], limit: 500 }, now))!;
    expect(served).toMatchObject({ dataAsOf: "2026-10-16", freshness: "EOD" });
    expect(served.data.total).toBe(3);
    // Most traded first; AADI has no value and goes last.
    expect(served.data.rows.map((row) => row.symbol)).toEqual(["BBCA", "GOTO", "AADI"]);
    const [bbca, goto, aadi] = served.data.rows;
    expect(bbca).toMatchObject({ name: "Bank Central Asia Tbk", price: 5225, frequency: 154_210, foreignNetShares: -110e6, marketCap: 5225 * 123_275_050_000, per: 11.06, roe: 0.2147, pbv: null, dividendYield: null });
    expect(bbca.change1D).toBeCloseTo(5225 / 6075 - 1, 12);
    // GOTO: derived PER is a deliberate null (losses); Pasardana's −40 is not used. Market cap from the snapshot.
    expect(goto).toMatchObject({ per: null, marketCap: 64e12, foreignNetShares: null });
    // AADI: no derived rows, so Pasardana's; no previous close, so no change.
    expect(aadi).toMatchObject({ per: 6.17137, roe: 0.2408, change1D: null, value: null });
    expect(served.data.ratioSources).toEqual({ BBCA: { per: "derived", roe: "derived" }, GOTO: { per: "derived" }, AADI: { per: "pasardana", roe: "pasardana" } });
    expect(served.data.supportedFields).toEqual(["price", "volume", "value", "frequency", "foreignNetShares", "foreignNetValue", "marketCap", "per", "roe", "change1D"]);
  });

  it("applies conditions and the limit; total counts every match", async () => {
    const lowPer = await serveScreener(store(), { conditions: [cond("per", "LT", 12)], limit: 500 }, now);
    expect(lowPer!.data.rows.map((row) => row.symbol)).toEqual(["BBCA", "AADI"]);
    const limited = await serveScreener(store(), { conditions: [], limit: 1 }, now);
    expect(limited!.data).toMatchObject({ total: 3, rows: [{ symbol: "BBCA" }] });
    expect(limited!.data.ratioSources).toEqual({ BBCA: { per: "derived", roe: "derived" } });
    // change1D is a fraction here (the app converts its percent input).
    const fallers = await serveScreener(store(), { conditions: [cond("change1D", "LT", -0.1)], limit: 500 }, now);
    expect(fallers!.data.rows.map((row) => row.symbol)).toEqual(["BBCA"]);
    expect(await serveScreener(new MemoryMarketStore(), { conditions: [], limit: 10 }, now)).toBeNull();
  });
});

describe("serveFundamentals", () => {
  it("groups lines per period, newest first, with units and currency", async () => {
    const served = (await serveFundamentals(store(), "BBCA"))!;
    expect(served).toMatchObject({ dataAsOf: "2026-06-30", freshness: "HISTORICAL" });
    expect(served.data).toEqual([
      { periodDate: "2026-06-30", periodType: "QUARTERLY", metrics: { netIncome: 14_850_323e6, sharesOutstanding: 122_841_751_300 }, units: { netIncome: "IDR", sharesOutstanding: "shares" }, currency: "IDR", source: "yahoo-fundamentals" },
      { periodDate: "2025-12-31", periodType: "ANNUAL", metrics: { epsDiluted: 467, netIncome: 57_537_287e6 }, units: { epsDiluted: "IDR/share", netIncome: "IDR" }, currency: "IDR", source: "yahoo-fundamentals" },
      { periodDate: "2025-12-31", periodType: "QUARTERLY", metrics: { netIncome: 14_139_872e6 }, units: { netIncome: "IDR" }, currency: "IDR", source: "yahoo-fundamentals" },
    ]);
    expect(await serveFundamentals(store(), "GOTO")).toBeNull();
  });
});
