// Radar and KSEI corporate-holder view: pure evaluation on synthetic rows, and serveStealth on the SYNTHETIC ownership
// uploads (fake tickers TEST1…TEST4). No real market or KSEI data.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RADAR_RULES_V0, RADAR_SIGNAL_KEYS, STEALTH_RULES_V0 } from "@/lib/radar/rules";
import { radarSchema, stealthOwnershipSchema } from "@/server/schemas/idx-bei";
import { tempDir, wib } from "../../test/support";
import { LocalRawStore } from "../fetch/raw-store";
import { MemoryRawDocumentIndex } from "../fetch/stores";
import { OwnershipService } from "../ownership/service";
import { MemoryOwnershipStore, type ChangeRecord } from "../ownership/store";
import {
  buildRadar, corporateChanges, emptyRadar, evaluateStock, foreignWindow, kseiCounts, priceBetween, priceChange, serveRadar, serveStealth, sessionsNeeded,
} from "./radar";
import { MemoryMarketStore, type DailyRecord } from "./store";

const DATES = Array.from({ length: 21 }, (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`);
const TRADING_DATE = DATES.at(-1)!;

type Overrides = Partial<Omit<DailyRecord, "symbol" | "date">>;
/** 21 quiet sessions at 1,000 (volume 1M, value Rp1 M, 100 trades, no foreign net); `last` overrides the newest one. */
function series(symbol: string, options: { each?: (index: number) => Overrides; last?: Overrides } = {}): DailyRecord[] {
  return DATES.map((date, index) => ({
    symbol, date, open: 1000, high: 1000, low: 1000, close: 1000, previousClose: 1000,
    volume: 1_000_000, value: 1_000_000_000, frequency: 100, foreignBuy: 100_000, foreignSell: 100_000,
    ...options.each?.(index), ...(index === DATES.length - 1 ? options.last : {}),
  }));
}

describe("radar rules", () => {
  it("needs the longest window or baseline plus the session before it", () => {
    expect(sessionsNeeded()).toBe(21);
  });
  it("every signal has a documented threshold", () => {
    expect(Object.keys(RADAR_RULES_V0.signals).sort()).toEqual([...RADAR_SIGNAL_KEYS].sort());
  });
});

describe("evaluateStock", () => {
  it("fires each signal at its threshold with the observed value and window", () => {
    const rows = series("AAAA", {
      // Foreign net buy 100k a session on 1M volume (10 %); price steps up 2 % a session over the last 5.
      each: (index) => ({ foreignBuy: 200_000, foreignSell: 100_000, close: index >= 16 ? Math.round(1000 * 1.02 ** (index - 15)) : 1000 }),
      // Newest session: 3× volume, 2.5× value per trade (Rp25 jt vs Rp10 jt).
      last: { volume: 3_000_000, value: 2_500_000_000, frequency: 100 },
    });
    const result = evaluateStock(rows, "AAAA", { month: "2026-08", bySymbol: new Map([["AAAA", { increases: 2, decreases: 0 }]]) });
    const fired = Object.fromEntries(result.fired.map((signal) => [signal.key, signal]));
    expect(Object.keys(fired).sort()).toEqual([...RADAR_SIGNAL_KEYS].sort());
    expect(fired.foreignNetBuy5).toMatchObject({ window: "5D", threshold: 0.05, detail: { netShares: 500_000, buySessions: 5, sellSessions: 0 } });
    // 5 × 100k net over 4 × 1M + 3M volume.
    expect(fired.foreignNetBuy5.observed).toBeCloseTo(500_000 / 7_000_000, 6);
    expect(fired.foreignNetBuy20).toMatchObject({ window: "20D", threshold: 0.03 });
    expect(fired.volumeSpike).toMatchObject({ observed: 3, threshold: 2, window: "1D" });
    expect(fired.orderSizeSpike).toMatchObject({ observed: 2.5, detail: { valuePerTradeIdr: 25_000_000 } });
    expect(fired.priceUp5.observed).toBeCloseTo(1.02 ** 5 - 1, 2);
    expect(fired.closeAboveAverage.observed).toBeGreaterThan(0.02);
    expect(fired.kseiHolderIncrease).toMatchObject({ observed: 2, threshold: 1, window: "2026-08" });
    expect(Object.values(result.status).every((status) => status === "ok")).toBe(true);
    expect(result.counter).toEqual([]);
  });

  it("evaluates but does not fire below the thresholds", () => {
    const result = evaluateStock(series("QUIET"), "QUIET", { month: "2026-08", bySymbol: new Map([["QUIET", { increases: 0, decreases: 0 }]]) });
    expect(result.fired).toEqual([]);
    expect(Object.values(result.status).every((status) => status === "ok")).toBe(true);
  });

  it("marks a signal missing when its data is absent, never zero", () => {
    const rows = series("GAPS", {
      // No foreign data on one of the newest 5 sessions; no trade counts anywhere (Yahoo-only rows).
      each: (index) => ({ frequency: null, ...(index === 18 ? { foreignBuy: null, foreignSell: null } : {}) }),
    });
    const result = evaluateStock(rows, "GAPS", null);
    expect(result.status).toMatchObject({ foreignNetBuy5: "missing", foreignNetBuy20: "missing", orderSizeSpike: "missing", kseiHolderIncrease: "missing", volumeSpike: "ok", priceUp5: "ok" });
    expect(result.fired).toEqual([]);

    const short = evaluateStock(series("NEW").slice(-4), "NEW", { month: "2026-08", bySymbol: new Map() });
    // Four sessions: nothing that needs 5+ sessions or a 20-session baseline can be evaluated; not in the KSEI list either.
    expect(Object.values(short.status).every((status) => status === "missing")).toBe(true);
  });

  it("lists counter-evidence: price against foreign flow, volume on a down session, KSEI decreases", () => {
    const rows = series("CNTR", {
      // Price up 6 % over 5 sessions while foreign investors sell 50k a session.
      each: (index) => ({ foreignBuy: 50_000, foreignSell: 100_000, close: index >= 16 ? 1060 : 1000 }),
      // Newest session: 2.4× volume and a lower close than the session before.
      last: { volume: 2_400_000, close: 1050, previousClose: 1060 },
    });
    const result = evaluateStock(rows, "CNTR", { month: "2026-08", bySymbol: new Map([["CNTR", { increases: 1, decreases: 2 }]]) });
    expect(result.counter.map((item) => item.key)).toEqual(["priceVsForeign5", "priceVsForeign20", "volumeOnDownSession", "kseiHolderDecrease"]);
    expect(result.counter[0]).toMatchObject({ window: "5D", values: { foreignNetShares: -250_000 } });
    expect(result.counter[0].values.priceChange).toBeCloseTo(0.05, 6);
    expect(result.counter[2].values).toMatchObject({ volumeRatio: 2.4 });
    expect(result.counter[3]).toMatchObject({ window: "2026-08", values: { decreases: 2, increases: 1 } });
    // The price signal still fires; the counter-evidence sits next to it.
    expect(result.fired.map((signal) => signal.key)).toContain("priceUp5");
  });

  it("windows cover the same sessions for price and flow", () => {
    const rows = series("WIN", { each: (index) => ({ close: 1000 + index }) });
    expect(priceChange(rows, 5)).toBeCloseTo(1020 / 1015 - 1, 9);
    expect(foreignWindow(rows, 5)).toMatchObject({ sessions: 5, netShares: 0, volume: 5_000_000 });
    expect(foreignWindow(rows.slice(-4), 5)).toBeNull();
  });
});

describe("buildRadar", () => {
  const meta = new Map([
    ["AAAA", { name: "PT Contoh A", sector: "Finance" }], ["BBBB", { name: "PT Contoh B", sector: "Energy" }],
    ["CCCC", { name: "PT Contoh C", sector: "Energy" }], ["QUIET", { name: "PT Tenang", sector: "Finance" }],
  ]);
  const rows = [
    // One signal (volume), small value.
    ...series("AAAA", { last: { volume: 2_500_000, value: 1_000_000_000 } }),
    // One signal (volume), larger value: ranks above AAAA.
    ...series("BBBB", { last: { volume: 2_500_000, value: 9_000_000_000, frequency: 900 } }),
    // Two signals (volume, order size).
    ...series("CCCC", { last: { volume: 2_500_000, value: 3_000_000_000, frequency: 100 } }),
    ...series("QUIET"),
    // Not in the active universe.
    ...series("GONE", { last: { volume: 9_000_000 } }),
    // No row on the trading date.
    ...series("OLD").slice(0, 20),
  ];

  it("ranks by firing signals, then traded value, and reports coverage", () => {
    const radar = radarSchema.parse(buildRadar(rows, TRADING_DATE, meta, null));
    expect(radar.stocks.map((stock) => [stock.symbol, stock.firedCount])).toEqual([["CCCC", 2], ["BBBB", 1], ["AAAA", 1]]);
    expect(radar.coverage).toMatchObject({ stocks: 4, listed: 3, returned: 3 });
    expect(radar.coverage.signals).toMatchObject({ volumeSpike: 4, foreignNetBuy5: 4, kseiHolderIncrease: 0 });
    expect(radar).toMatchObject({ tradingDate: TRADING_DATE, rulesVersion: RADAR_RULES_V0.version, kseiMonth: null });
    expect(radar.rules.volumeSpike).toEqual({ window: 1, baseline: 20, threshold: 2, unit: "ratio" });
    expect(radar.stocks[0]).toMatchObject({ name: "PT Contoh C", sector: "Energy", close: 1000, changePercent: 0, value: 3_000_000_000 });
    expect(radar.stocks[0].status.kseiHolderIncrease).toBe("missing");
  });

  it("caps the list without losing the count", () => {
    const radar = buildRadar(rows, TRADING_DATE, meta, null, { ...RADAR_RULES_V0, listLimit: 1 });
    expect(radar.coverage).toMatchObject({ listed: 3, returned: 1 });
    expect(radar.stocks.map((stock) => stock.symbol)).toEqual(["CCCC"]);
  });

  it("evaluates every stock when the universe is not stored yet", () => {
    expect(buildRadar(rows, TRADING_DATE, new Map(), null).coverage.stocks).toBe(5);
  });

  it("counts KSEI increases and decreases per listed symbol", () => {
    const ksei = kseiCounts("2026-08", ["AAAA"], [
      { symbol: "AAAA", kind: "INCREASE" }, { symbol: "AAAA", kind: "NEW" }, { symbol: "AAAA", kind: "DECREASE" }, { symbol: "ZZZZ", kind: "INCREASE" },
    ]);
    expect(ksei!.bySymbol.get("AAAA")).toEqual({ increases: 1, decreases: 1 });
    expect(ksei!.bySymbol.has("ZZZZ")).toBe(false);
    const radar = buildRadar(rows, TRADING_DATE, meta, ksei);
    expect(radar.kseiMonth).toBe("2026-08");
    expect(radar.coverage.signals.kseiHolderIncrease).toBe(1);
  });

  it("serves the newest session with its freshness, or nothing before any session is stored", async () => {
    expect(await serveRadar(new MemoryMarketStore(), null, wib("2026-09-21", "18:00"))).toBeNull();
    const served = (await serveRadar(new MemoryMarketStore({ daily: rows }), null, wib("2026-09-21", "18:00")))!;
    expect(served.dataAsOf).toBe(TRADING_DATE);
    expect(served.data.coverage.stocks).toBe(5);
    expect(radarSchema.parse(emptyRadar())).toMatchObject({ tradingDate: null, stocks: [], coverage: { stocks: 0 } });
  });
});

describe("KSEI corporate holders", () => {
  const change = (overrides: Partial<ChangeRecord>): ChangeRecord => ({
    toSetId: "to", fromSetId: "from", symbol: "TEST9", month: "2026-03", fromDate: "2026-02-27", toDate: "2026-03-31",
    holderKey: "h", holderName: "PT H", holderKind: "organisation", kind: "INCREASE",
    sharesBefore: "100", sharesAfter: "150", shareDelta: "50", percentBefore: "1.000000", percentAfter: "1.500000", ppDelta: "0.500000",
    flags: [], fromReferences: [], toReferences: [], derivation: "test", ...overrides,
  });
  const types: Record<string, string> = { a: "CP", b: "CP", c: "ID", d: "CP", e: "CP" };
  const typeOf = (item: ChangeRecord) => types[item.holderKey] ?? null;

  it("sums known corporate deltas only; new holders are counted, not summed", () => {
    const result = corporateChanges([
      change({ holderKey: "a", shareDelta: "50" }),
      change({ holderKey: "b", kind: "DECREASE", shareDelta: "-20" }),
      change({ holderKey: "c", shareDelta: "999" }), // an individual: not corporate
      change({ holderKey: "d", kind: "NEW", sharesBefore: null, shareDelta: null }),
      change({ holderKey: "e", kind: "UNCHANGED", shareDelta: "0" }),
    ], typeOf);
    expect(result.delta).toBe(BigInt(30));
    expect(result.newHolders).toBe(1);
    expect(result.increased).toBe(true);
    expect(result.holders.map((holder) => holder.holderKey)).toEqual(["a", "b", "d"]);
    expect(corporateChanges([change({ holderKey: "b", kind: "DECREASE", shareDelta: "-20" })], typeOf).increased).toBe(false);
  });

  it("uses a close only near its position date", () => {
    expect(priceBetween({ date: "2026-02-27", close: 1000 }, "2026-02-27", { date: "2026-03-31", close: 990 }, "2026-03-31")).toMatchObject({ changePercent: -0.01 });
    expect(priceBetween({ date: "2026-01-02", close: 1000 }, "2026-02-27", { date: "2026-03-31", close: 990 }, "2026-03-31")).toBeNull();
    expect(priceBetween(undefined, "2026-02-27", { date: "2026-03-31", close: 990 }, "2026-03-31")).toBeNull();
  });
});

describe("serveStealth on synthetic uploads", () => {
  let dir: Awaited<ReturnType<typeof tempDir>>;
  beforeEach(async () => { dir = await tempDir(); });
  afterEach(async () => { await dir.cleanup(); });

  const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../test/fixtures/ownership/${name}`, import.meta.url)));
  async function uploaded(months: Array<["synthetic-1pct-2026-02.pdf" | "synthetic-1pct-2026-03.pdf", string]>) {
    const store = new MemoryOwnershipStore();
    const service = new OwnershipService({ store, rawStore: new LocalRawStore(`${dir.path}/raw`), documents: new MemoryRawDocumentIndex(), now: () => new Date("2026-10-16T08:00:00Z") });
    for (const [name, month] of months) {
      await service.upload({ bytes: fixture(name), contentType: "application/pdf", fileName: name, asOfMonth: month, sourceLabel: `SYNTHETIC ${month}`, snapshotDate: null });
    }
    return store;
  }
  const closes = (feb: number, mar: number) => new MemoryMarketStore({
    daily: [
      { symbol: "TEST1", date: "2026-02-27", open: null, high: null, low: null, close: feb, previousClose: null, volume: null, value: null, frequency: null, foreignBuy: null, foreignSell: null },
      { symbol: "TEST1", date: "2026-03-31", open: null, high: null, low: null, close: mar, previousClose: null, volume: null, value: null, frequency: null, foreignBuy: null, foreignSell: null },
    ],
  });

  it("is empty before any upload", async () => {
    expect(await serveStealth(new MemoryOwnershipStore(), null)).toBeNull();
  });

  it("lists TEST1: its corporate parent added shares while the close was flat", async () => {
    const store = await uploaded([["synthetic-1pct-2026-02.pdf", "2026-02"], ["synthetic-1pct-2026-03.pdf", "2026-03"]]);
    const served = (await serveStealth(store, closes(500, 500)))!;
    const data = stealthOwnershipSchema.parse(served.data);
    expect(served).toMatchObject({ freshness: "HISTORICAL", dataAsOf: "2026-03-31" });
    expect(data).toMatchObject({ month: "2026-03", previousMonth: "2026-02", rulesVersion: STEALTH_RULES_V0.version, rules: { investorTypes: ["CP"], maxPriceChange: 0.01 } });
    // TEST1 (CP parent +10M) qualifies; TEST2's CP holdco decreased; TEST3 has no March list; TEST4 has no February list.
    expect(data.coverage).toMatchObject({ issuers: 3, corporateIncrease: 1, priceRose: 0, priceMissing: 0 });
    expect(data.stocks).toHaveLength(1);
    expect(data.stocks[0]).toMatchObject({
      symbol: "TEST1", name: "PT CONTOH DUMMY TBK", fromDate: "2026-02-27", toDate: "2026-03-31", combinedShareDelta: "10000000", newHolders: 0,
      price: { from: { date: "2026-02-27", close: 500 }, to: { date: "2026-03-31", close: 500 }, changePercent: 0 },
    });
    // Only corporate holders that changed: the unchanged CP custodian and the individuals are left out.
    expect(data.stocks[0].holders).toEqual([expect.objectContaining({ holderName: "PT CONTOH INDUK FIKTIF", investorType: "CP", kind: "INCREASE", shareDelta: "10000000", sharesBefore: "600000000", sharesAfter: "610000000" })]);
  });

  it("leaves out a stock whose close rose, and keeps one without closes as missing (never flat)", async () => {
    const store = await uploaded([["synthetic-1pct-2026-02.pdf", "2026-02"], ["synthetic-1pct-2026-03.pdf", "2026-03"]]);
    const rose = (await serveStealth(store, closes(500, 520)))!.data;
    expect(rose.coverage).toMatchObject({ corporateIncrease: 1, priceRose: 1 });
    expect(rose.stocks).toEqual([]);
    const missing = (await serveStealth(store, null))!.data;
    expect(missing.coverage).toMatchObject({ priceMissing: 1 });
    expect(missing.stocks[0]).toMatchObject({ symbol: "TEST1", price: null });
  });

  it("a single month has nothing to compare", async () => {
    const store = await uploaded([["synthetic-1pct-2026-02.pdf", "2026-02"]]);
    const served = (await serveStealth(store, null))!.data;
    expect(served).toMatchObject({ month: "2026-02", stocks: [], coverage: { issuers: 3, corporateIncrease: 0 } });
  });
});
