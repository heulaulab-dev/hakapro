import { describe, expect, test } from "vitest";
import { BASELINE_DIR, wib } from "../../../tests/support/fixtures";
import { makeRows } from "../../../tests/support/history-rows";
import { researchBriefSchema } from "@/lib/api/research";
import { withFreshness, type WithFreshness } from "@/lib/freshness";
import { mergeLastPrice } from "@/lib/last-price";
import { MarketDataError, unsupported } from "@/server/market/errors";
import { FixtureSource, RECORDED_DIR } from "@/server/market/fixture-source";
import type { Capability, MarketDataSource } from "@/server/market/source";
import type { BrokerSummary, History, LastPrice } from "@/server/market/types";
import { getQuotes } from "./quotes";
import { BriefUnavailableError, buildResearchBrief, clearResearchCache, getResearchBrief, UnknownTickerError } from "./research-brief";

type Impl = Partial<Record<Capability, (...args: never[]) => Promise<WithFreshness<unknown>>>>;

/** A source that answers only the capabilities given; everything else is UNSUPPORTED (as BaseMarketDataSource). */
function stub(impl: Impl, calls: string[] = []): MarketDataSource {
  return new Proxy({ id: "stub" } as MarketDataSource, {
    get(_target, property) {
      if (property === "id") return "stub";
      if (typeof property === "symbol" || property === "then") return undefined;
      return async (...args: never[]) => {
        calls.push(String(property));
        const run = impl[property as Capability];
        if (!run) throw unsupported("stub", String(property));
        return run(...args);
      };
    },
  });
}

// Wednesday 2026-10-21 after the close: a history ending today is current (EOD).
const NOW = wib("2026-10-21T17:00:00");
const ok = <T>(data: T, asOf: string | null) => withFreshness(data, { freshness: "EOD", asOf, source: "stub" });
const fail = (code: MarketDataError["code"]) => async () => { throw new MarketDataError(code, code, 503); };

const rising = makeRows(Array.from({ length: 60 }, (_, index) => 1_000 + index * 10), { foreign: Array.from({ length: 60 }, () => -1_000) });
const history = (rows = rising) => async () => ok<History>({ symbol: "TEST", frame: "daily", rows, available: null }, rows.at(-1)?.date ?? null);
const price = (sessionDate: string, lastPriceIdr: number) => async () => ok<LastPrice>({
  symbol: "TEST", lastPriceIdr, frequency: 0, lots: 0, valueIdr: 0, sessionDate, tradedToday: false, lastTradeTime: null, servedTime: "17:00:00", marketState: "closed", quoteAgeMs: null,
}, sessionDate);
const search = async () => ok([{ symbol: "TEST", companyName: "Test Tbk.", lastDate: "2026-10-21" }], "2026-10-21");
/** Echoes the requested window and flow, with one broker netting `net` IDR. */
const broker = (net: (flow: string) => number) => async (_symbol: string, query: { startDate?: string; endDate?: string; flow?: "foreign" | "domestic" }) => ok<BrokerSummary>({
  symbol: "TEST", startDate: query.startDate ?? "2026-10-21", endDate: query.endDate ?? "2026-10-21", availableFrom: "2020-01-02", availableTo: "2026-10-21",
  flow: query.flow ?? "all", net: false, levels: [],
  brokers: [{ code: "AA", name: "AA", buyValueIdr: 0, sellValueIdr: 0, netValueIdr: net(query.flow ?? "all"), buyVolumeShares: 0, sellVolumeShares: 0, netVolumeShares: 0, buyFrequency: 0, sellFrequency: 0, netFrequency: 0 }],
}, query.endDate ?? "2026-10-21");
const insiders = async () => ok({ symbol: "TEST", total: 1, page: 1, pageSize: 15, totalPages: 1, rows: [
  { person: "Direktur A", date: "2026-10-14", action: "SELL" as const, nationality: "ID", roles: ["Direktur"], broker: null, previousShares: null, currentShares: null, changeShares: -50_000, previousPercent: null, currentPercent: null, changePercent: null, priceIdr: 1_500 },
] }, "2026-10-14");

const complete: Impl = { price: price("2026-10-21", 1_590), history: history(), search, brokerSummary: broker((flow) => (flow === "foreign" ? -3e9 : 3e9)), insiders } as Impl;

describe("research brief builder", () => {
  test("phase 1: no score, weights 0, points null; KSEI is a missing slot; confidence = share of ok components", async () => {
    const brief = await buildResearchBrief(stub(complete), "TEST", { now: NOW });
    expect(brief.score).toEqual({ value: null, confidence: 0.83, version: "none" });
    expect(brief.components.map((item) => [item.key, item.status])).toEqual([
      ["momentum", "ok"], ["foreign", "ok"], ["broker", "ok"], ["ksei", "missing"], ["insider", "ok"], ["volume", "ok"],
    ]);
    for (const item of brief.components) {
      expect(item.points).toBeNull();
      expect(item.weight).toBe(0);
    }
    expect(brief.components.find((item) => item.key === "ksei")).toMatchObject({ reason: "NOT_AVAILABLE", source: { table: "ksei_ownership", asOf: null } });
    expect(brief.quota).toEqual({ used: 0, limit: null, charged: false });
    expect(brief).toMatchObject({ code: "TEST", name: "Test Tbk.", asOf: "2026-10-21", freshness: "fresh" });
    // The output satisfies the client contract.
    expect(researchBriefSchema.safeParse(brief).success).toBe(true);
  });

  test("windows: net foreign shares and broker category values per 1D/5D/7D/14D/30D", async () => {
    const brief = await buildResearchBrief(stub(complete), "TEST", { now: NOW });
    const foreign = brief.components.find((item) => item.key === "foreign")!;
    expect(foreign.raw).toMatchObject({ net1D: -1_000, net5D: -5_000, net7D: -7_000, net14D: -14_000, net30D: -30_000, sellSessions: 30, flowSessions: 30 });
    const brokerComponent = brief.components.find((item) => item.key === "broker")!;
    expect(brokerComponent.raw).toMatchObject({ foreign1D: -3e9, domestic1D: 3e9, foreign30D: -3e9, start5D: rising.at(-5)!.date, end5D: "2026-10-21", localInstitution: null, retail: null });
    expect(brief.checks).toEqual([
      { key: "price_history", result: "match" },
      { key: "foreign_sources", result: "match" },
      { key: "broker_windows", result: "match" },
    ]);
  });

  test("counter-evidence: rising price against net foreign selling, from both foreign datasets and insiders", async () => {
    const brief = await buildResearchBrief(stub(complete), "TEST", { now: NOW });
    const keys = brief.counterEvidence.map((item) => item.key);
    for (const window of ["1D", "5D", "7D", "14D", "30D"]) {
      expect(keys).toContain(`foreign_${window}`);
      expect(keys).toContain(`broker_foreign_${window}`);
    }
    expect(keys).toContain("insider");
    for (const item of brief.counterEvidence) expect(item.text.id.length && item.text.en.length).toBeTruthy();
  });

  test("a failing capability marks only its component missing; the brief still renders with lower confidence", async () => {
    const brief = await buildResearchBrief(stub({ ...complete, insiders: fail("RATE_LIMITED"), brokerSummary: fail("PROVIDER_UNAVAILABLE") } as Impl), "TEST", { now: NOW });
    expect(brief.components.find((item) => item.key === "insider")).toMatchObject({ status: "missing", reason: "RATE_LIMITED", points: null });
    expect(brief.components.find((item) => item.key === "broker")).toMatchObject({ status: "missing", reason: "PROVIDER_UNAVAILABLE" });
    expect(brief.score.confidence).toBe(0.5);
    expect(brief.price.last).toBe(1_590);
  });

  test("a broker response not labelled with the requested category is never relabelled", async () => {
    // Answers every request as "all investors", whatever flow was asked for.
    const unlabelled: Impl = { ...complete, brokerSummary: async (symbol: string, query: { startDate?: string; endDate?: string }) => broker(() => 1e9)(symbol, { startDate: query.startDate, endDate: query.endDate }) } as Impl;
    const brief = await buildResearchBrief(stub(unlabelled), "TEST", { now: NOW });
    expect(brief.components.find((item) => item.key === "broker")).toMatchObject({ status: "missing", reason: "NO_CATEGORY_BREAKDOWN" });
  });

  test("an old dataset is stale, not ok", async () => {
    const old = makeRows(Array.from({ length: 60 }, () => 100), { end: "2026-09-18" });
    const brief = await buildResearchBrief(stub({ ...complete, history: history(old), price: price("2026-09-18", 100) } as Impl), "TEST", { now: NOW });
    expect(brief.freshness).toBe("stale");
    expect(brief.components.find((item) => item.key === "momentum")!.status).toBe("stale");
    // Only the insider disclosures (not dated by session) remain ok: 1 of 6.
    expect(brief.score.confidence).toBe(0.17);
  });

  test("404 only when a lookup answered and nothing knows the ticker", async () => {
    const unknown = stub({ search: async () => ok([], null), price: fail("NOT_FOUND"), history: fail("NOT_FOUND") } as Impl);
    await expect(buildResearchBrief(unknown, "ZZZZ", { now: NOW })).rejects.toBeInstanceOf(UnknownTickerError);
  });

  test("503 data_unavailable when the price is missing, listing missing components, without further provider calls", async () => {
    const calls: string[] = [];
    const error = await buildResearchBrief(stub({ search, price: fail("PROVIDER_UNAVAILABLE"), history: fail("PROVIDER_UNAVAILABLE") } as Impl, calls), "TEST", { now: NOW }).catch((caught) => caught);
    expect(error).toBeInstanceOf(BriefUnavailableError);
    expect((error as BriefUnavailableError).missing).toEqual(["price", "momentum", "foreign", "volume", "ksei"]);
    expect(calls).not.toContain("brokerSummary");
    expect(calls).not.toContain("insiders");
  });

  test("the baseline fixture BBCA brief builds from recorded data (history close as price, no category breakdown)", async () => {
    const brief = await buildResearchBrief(new FixtureSource(() => NOW, BASELINE_DIR), "BBCA", { now: NOW });
    expect(brief.price).toMatchObject({ last: 6300, changePct: -0.79, session: "2026-09-18" });
    expect(brief.freshness).toBe("stale");
    expect(brief.components.find((item) => item.key === "broker")).toMatchObject({ status: "missing", reason: "NO_CATEGORY_BREAKDOWN" });
    expect(brief.sources.map((source) => source.table)).toEqual(["fixture:arjum/history", "fixture:arjum/insiders"]);
    expect(researchBriefSchema.safeParse(brief).success).toBe(true);
  });
});

describe("price reconciliation with other surfaces (acceptance criterion 1)", () => {
  test("recorded BBCA: brief, stock page header and watchlist quotes show the same last price and change", async () => {
    const source = new FixtureSource(() => NOW, RECORDED_DIR);
    const brief = await buildResearchBrief(source, "BBCA", { now: NOW });
    // Stock page header (StockHeaderLive): daily history (OVERVIEW_HISTORY) merged with today's price.
    const [pageHistory, pagePrice] = await Promise.all([source.history("BBCA", { frame: "daily", limit: 250 }), source.price("BBCA")]);
    const header = mergeLastPrice(pageHistory.data.rows, pagePrice.data)!;
    const quotes = await getQuotes(source, ["BBCA"], undefined, NOW);
    const quote = quotes.data[0];
    expect(quote.status).toBe("ok");
    for (const surface of [header, quote.status === "ok" ? quote : null]) {
      expect(surface).not.toBeNull();
      expect({ date: surface!.date, close: surface!.close, changePercent: surface!.changePercent }).toEqual({ date: brief.price.session, close: brief.price.last, changePercent: brief.price.changePct });
    }
  });

  test("intraday price for the session after the history's last day: same merge as the stock page", async () => {
    const rows = makeRows(Array.from({ length: 60 }, (_, index) => 1_000 + index), { end: "2026-10-20" });
    const source = stub({ ...complete, history: history(rows), price: price("2026-10-21", 1_100) } as Impl);
    const brief = await buildResearchBrief(source, "TEST", { now: NOW });
    const header = mergeLastPrice(rows, (await source.price("TEST")).data as LastPrice)!;
    expect(brief.price).toMatchObject({ last: header.close, change: header.change, changePct: header.changePercent, session: "2026-10-21" });
    expect(brief.price.changePct).toBeCloseTo(((1_100 - 1_059) / 1_059) * 100, 2);
  });
});

describe("per-ticker per-day cache", () => {
  test("a complete brief is reused within the day and rebuilt on the next day", async () => {
    clearResearchCache();
    const calls: string[] = [];
    const source = stub(complete, calls);
    const first = await getResearchBrief(source, "TEST", { now: () => NOW });
    const count = calls.length;
    expect(await getResearchBrief(source, "TEST", { now: () => wib("2026-10-21T20:00:00") })).toBe(first);
    expect(calls.length).toBe(count);
    await getResearchBrief(source, "TEST", { now: () => wib("2026-10-22T17:00:00") });
    expect(calls.length).toBeGreaterThan(count);
    clearResearchCache();
  });
});
