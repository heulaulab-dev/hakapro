import { describe, expect, it } from "vitest";
import { groupsSchema, idxBeiEnvelope } from "@/server/schemas/idx-bei";
import { wib } from "../../test/support";
import { MemoryCursorStore, MemoryRunRecorder, MemorySourceStateStore } from "../fetch/stores";
import { catalogProblems, type GroupCatalog } from "../groups/catalog";
import { GROUP_CATALOG } from "../groups/groups";
import { createApp } from "../http/app";
import { PauseGuard } from "../schedule/pause";
import { Scheduler } from "../schedule/scheduler";
import { divergenceOf, serveGroups } from "./groups";
import { serveMarket } from "./market";
import { MemoryMarketStore, type DailyRecord, type SecurityRecord } from "./store";

const day = (symbol: string, date: string, close: number, previousClose: number | null, extra: Partial<DailyRecord> = {}): DailyRecord => ({
  symbol, date, open: close, high: close, low: close, close, previousClose, volume: 1000, value: 1_000, frequency: 10, foreignBuy: null, foreignSell: null, ...extra,
});
const security = (symbol: string, extra: Partial<SecurityRecord> = {}): SecurityRecord => ({
  symbol, name: `${symbol} Tbk`, sector: "Finance", subsector: null, board: null, sharesOutstanding: null, freeFloatPct: null, asOf: wib("2026-10-16", "16:35"), ...extra,
});
const AFTER_CLOSE = wib("2026-10-16", "17:00");
const source = { label: "Annual report", url: "https://example.com/ar" };

const CATALOG: GroupCatalog = {
  version: "test-1", reviewedAt: "2026-10-21",
  groups: [
    { id: "alpha", name: { id: "Grup Alpha", en: "Alpha Group" }, confidence: "sourced", reviewedAt: "2026-10-21", sources: [source],
      members: [{ symbol: "AAAA" }, { symbol: "BBBB", confidence: "unverified", note: "Joint control" }, { symbol: "GONE" }, { symbol: "OLDX" }, { symbol: "QUIET" }] },
    { id: "beta", name: { id: "Grup Beta", en: "Beta Group" }, confidence: "unverified", reviewedAt: "2026-10-21", sources: [source],
      members: [{ symbol: "CCCC" }, { symbol: "DDDD" }] },
    { id: "empty", name: { id: "Grup Kosong", en: "Empty Group" }, confidence: "sourced", reviewedAt: "2026-10-21", sources: [source], members: [{ symbol: "NONE" }] },
  ],
};
const SECURITIES = [security("AAAA"), security("BBBB"), security("CCCC"), security("DDDD"), security("OLDX", { active: false }), security("QUIET"), security("NONE")];

describe("divergenceOf", () => {
  it("flags only opposite non-zero signs", () => {
    expect(divergenceOf(0.02, -5)).toBe("price_up_foreign_net_sell");
    expect(divergenceOf(-0.02, 5)).toBe("price_down_foreign_net_buy");
    expect(divergenceOf(0.02, 5)).toBeNull();
    expect(divergenceOf(-0.02, -5)).toBeNull();
    expect(divergenceOf(0, -5)).toBeNull();
    expect(divergenceOf(0.02, 0)).toBeNull();
    expect(divergenceOf(null, -5)).toBeNull();
    expect(divergenceOf(0.02, null)).toBeNull();
  });
});

describe("serveGroups 1D", () => {
  const store = new MemoryMarketStore({
    securities: SECURITIES,
    daily: [
      // Alpha: price up on value, foreign net sellers → divergence.
      day("AAAA", "2026-10-16", 110, 100, { value: 3_000, foreignBuy: 10, foreignSell: 30 }),
      day("BBBB", "2026-10-16", 95, 100, { value: 1_000, foreignBuy: 5, foreignSell: 5 }),
      // Beta: price down, DDDD without foreign data.
      day("CCCC", "2026-10-16", 98, 100, { value: 2_000, foreignBuy: 50, foreignSell: 10 }),
      day("DDDD", "2026-10-16", 99, 100, { value: 2_000 }),
      day("XXXX", "2026-10-16", 200, 100),
    ],
  });

  it("measures each group over the session: breadth, mean and value-weighted change, value, best/worst", async () => {
    const served = (await serveGroups(store, "1D", AFTER_CLOSE, CATALOG))!;
    expect(served).toMatchObject({ dataAsOf: "2026-10-16", freshness: "EOD" });
    expect(served.data.window).toEqual({ id: "1D", sessions: 1, from: "2026-10-16", to: "2026-10-16", basis: "daily" });
    expect(served.data.catalog).toEqual({ version: "test-1", reviewedAt: "2026-10-21" });
    // Ranked by value-weighted change; the group without data last.
    expect(served.data.groups.map((group) => group.id)).toEqual(["alpha", "beta", "empty"]);
    const [alpha, beta, empty] = served.data.groups;
    expect(alpha).toMatchObject({ members: 5, membersWithData: 2, advancers: 1, decliners: 1, unchanged: 0, value: 4_000, best: { symbol: "AAAA" }, worst: { symbol: "BBBB" } });
    expect(alpha.changePercent).toBeCloseTo(0.025, 10);
    expect(alpha.valueWeightedChangePercent).toBeCloseTo((0.1 * 3_000 - 0.05 * 1_000) / 4_000, 10);
    expect(beta.valueWeightedChangePercent).toBeCloseTo(-0.015, 10);
    expect(empty).toMatchObject({ membersWithData: 0, changePercent: null, valueWeightedChangePercent: null, best: null, worst: null, divergence: null, noDataSymbols: ["NONE"] });
    expect(groupsSchema.parse(served.data)).toBeTruthy();
  });

  it("estimates net foreign value as (buy − sell) × close and states the divergence with price", async () => {
    const [alpha, beta] = (await serveGroups(store, "1D", AFTER_CLOSE, CATALOG))!.data.groups;
    expect(alpha.foreign).toEqual({ netValueEstimate: (10 - 30) * 110 + 0, members: 2, partialMembers: 0 });
    expect(alpha.divergence).toBe("price_up_foreign_net_sell");
    expect(alpha.stocks.find((stock) => stock.symbol === "AAAA")).toMatchObject({ netForeignValueEstimate: -2_200, foreignSessions: 1, divergence: "price_up_foreign_net_sell" });
    // DDDD has no foreign data: only CCCC counts.
    expect(beta.foreign).toEqual({ netValueEstimate: 40 * 98, members: 1, partialMembers: 0 });
    expect(beta.divergence).toBe("price_down_foreign_net_buy");
    expect(beta.stocks.find((stock) => stock.symbol === "DDDD")).toMatchObject({ netForeignValueEstimate: null, foreignSessions: 0, divergence: null });
  });

  it("reports unknown, inactive and no-data members instead of failing, and keeps member confidence", async () => {
    const [alpha, beta] = (await serveGroups(store, "1D", AFTER_CLOSE, CATALOG))!.data.groups;
    expect(alpha).toMatchObject({ unknownSymbols: ["GONE"], inactiveSymbols: ["OLDX"], noDataSymbols: ["QUIET"] });
    expect(alpha.stocks.map((stock) => [stock.symbol, stock.confidence, stock.note])).toEqual([["AAAA", "sourced", null], ["BBBB", "unverified", "Joint control"]]);
    expect(beta.stocks.every((stock) => stock.confidence === "unverified")).toBe(true);
  });

  it("uses the same change per stock as /v1/market, including a newer intraday snapshot (no foreign data then)", async () => {
    const intraday = new MemoryMarketStore({
      securities: SECURITIES,
      daily: [day("AAAA", "2026-10-16", 110, 100, { foreignBuy: 1, foreignSell: 2 }), day("CCCC", "2026-10-16", 98, 100)],
      intraday: [{ symbol: "AAAA", ts: wib("2026-10-19", "10:00"), last: 121, open: 110, high: 121, low: 110, changePercent: 0.1, volume: 5, value: 500 }],
    });
    const now = wib("2026-10-19", "10:05");
    const [groups, market] = await Promise.all([serveGroups(intraday, "1D", now, CATALOG), serveMarket(intraday, now)]);
    expect(groups).toMatchObject({ freshness: "DELAYED", data: { window: { basis: "intraday", from: "2026-10-19", to: "2026-10-19" } } });
    const alpha = groups!.data.groups.find((group) => group.id === "alpha")!;
    expect(alpha.best!.changePercent).toBe(market!.data.movers.find((row) => row.symbol === "AAAA")!.changePercent);
    expect(alpha.foreign).toEqual({ netValueEstimate: null, members: 0, partialMembers: 0 });
    expect(alpha.divergence).toBeNull();
  });

  it("returns null without any member row", async () => {
    expect(await serveGroups(new MemoryMarketStore(), "1D", AFTER_CLOSE, CATALOG)).toBeNull();
    expect(await serveGroups(new MemoryMarketStore({ daily: [day("XXXX", "2026-10-16", 1, 1)] }), "1D", AFTER_CLOSE, CATALOG)).toBeNull();
  });
});

describe("serveGroups 5D/20D", () => {
  const dates = ["2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
  const flow = (symbol: string, closes: number[], extra: (index: number) => Partial<DailyRecord> = () => ({})) =>
    closes.map((close, index) => day(symbol, dates[index], close, index ? closes[index - 1] : null, extra(index)));

  it("measures from the close before the window to the last close, summing value and foreign over the window", async () => {
    const store = new MemoryMarketStore({
      securities: SECURITIES,
      daily: [
        ...flow("AAAA", [100, 101, 102, 103, 104, 120], () => ({ value: 1_000, foreignBuy: 2, foreignSell: 1 })),
        // BBBB: foreign data on only some sessions → partial, left out of the group's estimate.
        ...flow("BBBB", [50, 50, 49, 48, 47, 40], (index) => ({ value: 500, ...(index % 2 ? { foreignBuy: 0, foreignSell: 100 } : {}) })),
        // CCCC: a split in the window → its change is left out and flagged.
        ...flow("CCCC", [1000, 1000, 1000, 200, 200, 210], () => ({ value: 100 })),
      ],
      actions: [{ symbol: "CCCC", exDate: "2026-10-14", type: "SPLIT", description: "Stock split 1:5", asOf: AFTER_CLOSE }],
    });
    const served = (await serveGroups(store, "5D", AFTER_CLOSE, CATALOG))!;
    expect(served).toMatchObject({ dataAsOf: "2026-10-16", freshness: "EOD" });
    expect(served.data.window).toEqual({ id: "5D", sessions: 5, from: "2026-10-12", to: "2026-10-16", basis: "daily" });
    const alpha = served.data.groups.find((group) => group.id === "alpha")!;
    const a = alpha.stocks.find((stock) => stock.symbol === "AAAA")!;
    expect(a).toMatchObject({ close: 120, sessions: 5, value: 5_000, foreignSessions: 5, corporateAction: false });
    expect(a.changePercent).toBeCloseTo(120 / 100 - 1, 10);
    expect(a.netForeignValueEstimate).toBe(101 + 102 + 103 + 104 + 120);
    const b = alpha.stocks.find((stock) => stock.symbol === "BBBB")!;
    expect(b.changePercent).toBeCloseTo(40 / 50 - 1, 10);
    expect(alpha.foreign).toEqual({ netValueEstimate: a.netForeignValueEstimate, members: 1, partialMembers: 1 });
    expect(alpha.valueWeightedChangePercent).toBeCloseTo((0.2 * 5_000 + -0.2 * 2_500) / 7_500, 10);
    expect(alpha.divergence).toBeNull();

    const beta = served.data.groups.find((group) => group.id === "beta")!;
    expect(beta.stocks[0]).toMatchObject({ symbol: "CCCC", corporateAction: true, changePercent: null, value: 500 });
    expect(beta).toMatchObject({ membersWithData: 1, changePercent: null, valueWeightedChangePercent: null, value: 500 });
  });

  it("uses the last close before the window for a stock that did not trade on its first day", async () => {
    const store = new MemoryMarketStore({
      securities: SECURITIES,
      daily: [...flow("AAAA", [100, 101, 102, 103, 104, 105]), day("DDDD", "2026-10-09", 80, 80), day("DDDD", "2026-10-15", 88, 85)],
    });
    const served = (await serveGroups(store, "5D", AFTER_CLOSE, CATALOG))!;
    const d = served.data.groups.find((group) => group.id === "beta")!.stocks[0];
    expect(d).toMatchObject({ symbol: "DDDD", sessions: 1, close: 88 });
    expect(d.changePercent).toBeCloseTo(88 / 80 - 1, 10);
  });

  it("caps the window at the sessions stored", async () => {
    const store = new MemoryMarketStore({ securities: SECURITIES, daily: flow("AAAA", [100, 101, 102]) });
    const served = (await serveGroups(store, "20D", wib("2026-10-13", "17:00"), CATALOG))!;
    expect(served.data.window).toMatchObject({ id: "20D", sessions: 3, from: "2026-10-09", to: "2026-10-13" });
    // No close before the first stored session and no previous close on it: no change, never a fake one.
    expect(served.data.groups[0].stocks[0]).toMatchObject({ symbol: "AAAA", changePercent: null });
  });
});

describe("the curated catalog", () => {
  it("is well-formed: ids, IDX codes, https sources, review dates", () => {
    expect(catalogProblems(GROUP_CATALOG)).toEqual([]);
    expect(GROUP_CATALOG.groups.length).toBeGreaterThan(0);
  });

  it("reports structural problems", () => {
    const bad: GroupCatalog = {
      version: "x", reviewedAt: "21-10-2026",
      groups: [
        { id: "Bad Id", name: { id: "", en: "x" }, confidence: "sourced", reviewedAt: "2026-10-21", members: [{ symbol: "aaaa" }, { symbol: "BBBB" }, { symbol: "BBBB" }], sources: [{ label: "x", url: "http://insecure.example" }] },
        { id: "dup", name: { id: "a", en: "a" }, confidence: "sourced", reviewedAt: "2026-10-21", members: [], sources: [] },
        { id: "dup", name: { id: "a", en: "a" }, confidence: "sourced", reviewedAt: "2026-10-21", members: [{ symbol: "CCCC" }], sources: [source] },
      ],
    };
    const problems = catalogProblems(bad).join("\n");
    for (const expected of ["catalog reviewedAt", "kebab-case", "name needs", "not an https URL", "not an IDX code", "listed twice", "no members", "no sources", "duplicate id"]) {
      expect(problems).toContain(expected);
    }
  });
});

describe("GET /v1/groups", () => {
  function call(path: string, market?: MemoryMarketStore) {
    const pause = new PauseGuard("/nonexistent-engine-test", 85, { cacheMs: 0, measure: async () => 10 });
    const scheduler = new Scheduler({ jobs: [], pause, runs: new MemoryRunRecorder(), cursors: new MemoryCursorStore(), sourceState: new MemorySourceStateStore() });
    const app = createApp({ ping: async () => true, pause, scheduler, rawStoreKind: "local", sourceHealth: async () => [], unblockSource: async () => false, now: () => AFTER_CLOSE, market, groups: CATALOG });
    return app(new Request(`http://engine.test${path}`));
  }

  it("defaults to 1D, accepts 5D/20D (any case), and rejects other windows", async () => {
    const market = new MemoryMarketStore({ securities: SECURITIES, daily: [day("AAAA", "2026-10-16", 110, 100)] });
    const body = idxBeiEnvelope(groupsSchema).parse(await (await call("/v1/groups", market)).json());
    expect(body.data.window.id).toBe("1D");
    expect(body.meta.freshness).toBe("EOD");
    expect(idxBeiEnvelope(groupsSchema).parse(await (await call("/v1/groups?window=5d", market)).json()).data.window.id).toBe("5D");
    expect((await call("/v1/groups?window=1W", market)).status).toBe(400);
  });

  it("answers the empty UNAVAILABLE form without stored data", async () => {
    const body = idxBeiEnvelope(groupsSchema).parse(await (await call("/v1/groups?window=20D")).json());
    expect(body.meta).toMatchObject({ dataAsOf: null, freshness: "UNAVAILABLE" });
    expect(body.data).toEqual({ window: { id: "20D", sessions: 0, from: null, to: null, basis: "daily" }, catalog: { version: "test-1", reviewedAt: "2026-10-21" }, groups: [] });
  });
});
