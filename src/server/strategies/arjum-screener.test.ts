import { describe, expect, test, vi } from "vitest";
import { BASELINE_DIR, fixture, wib } from "../../../tests/support/fixtures";
import { withFreshness, type WithFreshness } from "@/lib/freshness";
import { CRITERION_KEYS, strategyBoardSchema, type ScreenerCandidate } from "@/lib/strategies/contract";
import { FixtureSource } from "@/server/market/fixture-source";
import type { MarketDataSource } from "@/server/market/source";
import type { StrategyScreen } from "@/server/market/types";
import { screenerResponseSchema } from "@/server/schemas/arjum";
import { KNOWN_FLAGS, parseStrategyScreen } from "@/server/services/why-matched";
import { arjumScreenerSource, fromArjumScreen } from "./arjum-screener";
import { strategyBoard } from "./index";

const recorded = () => new FixtureSource(() => wib("2026-09-18T10:30:00"), BASELINE_DIR).strategies();
const envelope = (name: string, asOf?: string | null): WithFreshness<StrategyScreen> => {
  const { screen } = parseStrategyScreen(screenerResponseSchema.parse(fixture(name)));
  return withFreshness(screen, { freshness: "EOD", asOf: asOf === undefined ? screen.date : asOf, source: "arjum" });
};
const bySymbol = (candidates: ScreenerCandidate[], symbol: string) => candidates.find((candidate) => candidate.symbol === symbol)!;

describe("arjum screener → Strategy Engine contract", () => {
  test("recorded V5.2: strategies, candidates and context satisfy the contract", async () => {
    const { context, strategies, candidates } = fromArjumScreen(await recorded());
    expect(strategyBoardSchema.parse({ contexts: [context], strategies, candidates })).toBeTruthy();
    expect(context).toEqual({ source: "ARJUM_SCREENER", version: "V5.2", marketCondition: { label: "FLAT MARKET", averageChangePercent: 0.1 }, universe: { covered: 963, liquid: 280, skipped: 683 } });
    expect(strategies).toEqual([{
      id: "akumulasi-senyap", label: "AKUMULASI SENYAP", description: "Akumulasi senyap versi base-only, belum ada edge historis khusus",
      source: "ARJUM_SCREENER", kind: "EOD", dataAsOf: "2026-09-18", freshness: "HISTORICAL",
    }]);
    expect(candidates.map((candidate) => candidate.symbol)).toEqual(["SOCI", "HRTA"]);
    expect(candidates[0]).toEqual({
      symbol: "SOCI", name: "Soechi Lines Tbk.", strategyId: "akumulasi-senyap",
      detectedAt: "2026-09-18", dataAsOf: "2026-09-18", freshness: "HISTORICAL",
      score: null,
      reasons: [{ kind: "criterion", key: "foreignBuying" }, { kind: "criterion", key: "quietAccumulation" }, { kind: "note", text: "mode senyap" }],
      metrics: [],
      source: "ARJUM_SCREENER",
    });
  });

  test("live 2026-10-02: pattern and notes become reasons; win rate, potensi, drawdown and arrows never appear", () => {
    const { candidates } = fromArjumScreen(envelope("screener-2026-10-02"));
    const sapx = bySymbol(candidates, "SAPX");
    expect(sapx.strategyId).toBe("risiko-pantulan");
    expect(sapx.reasons).toEqual([
      { kind: "criterion", key: "historicalEdge" },
      { kind: "pattern", text: "Gabungan (Asing + Teknikal)" },
      { kind: "note", text: "jatuh tajam" },
      { kind: "note", text: "teknikal lemah" },
    ]);
    // The row carries wr_event 71.4, potential 15 and drawdown -5: none becomes a metric or a score.
    for (const candidate of candidates) {
      expect(candidate.score).toBeNull();
      expect(candidate.metrics).toEqual([]);
    }
    expect(JSON.stringify(candidates)).not.toMatch(/potensi|WR Event|71\.4|DD -|⬆|⬇/);
  });

  test("unrecognized provider flags stay visible as unrecognized reasons", () => {
    const base = envelope("screener");
    const flagged = { ...base, data: { ...base.data, strategies: [{ ...base.data.strategies[0], matches: [{ ...base.data.strategies[0].matches[0], criteria: [{ kind: "unrecognized" as const, flag: "🦄", providerLabel: "langka" }] }] }] } };
    expect(fromArjumScreen(flagged).candidates[0].reasons).toEqual([{ kind: "unrecognized", code: "🦄", label: "langka" }, { kind: "note", text: "mode senyap" }]);
  });

  test("an unreadable screen date leaves detectedAt and dataAsOf null and the data UNAVAILABLE", () => {
    const base = envelope("screener", null);
    const { strategies, candidates } = fromArjumScreen({ ...base, data: { ...base.data, date: null } });
    expect(strategies[0]).toMatchObject({ dataAsOf: null, freshness: "UNAVAILABLE" });
    expect(candidates[0]).toMatchObject({ detectedAt: null, dataAsOf: null, freshness: "UNAVAILABLE" });
  });

  test("every provider flag maps to a contract criterion key", () => {
    expect(new Set(Object.values(KNOWN_FLAGS).map((meta) => meta.key))).toEqual(new Set(CRITERION_KEYS));
  });
});

describe("arjumScreenerSource", () => {
  test("list and candidates for every strategy cost one upstream request", async () => {
    const strategies = vi.fn(async () => envelope("screener-2026-10-02"));
    const source = arjumScreenerSource({ strategies } as unknown as MarketDataSource);
    const list = await source.list();
    expect(list.map((strategy) => strategy.id)).toEqual(["risiko-pantulan", "konflik-distribusi", "akumulasi-senyap"]);
    const counts = await Promise.all(list.map(async (strategy) => (await source.candidates(strategy.id)).length));
    expect(counts).toEqual([2, 1, 3]);
    expect(await source.candidates("unknown")).toEqual([]);
    expect(strategies).toHaveBeenCalledTimes(1);
  });

  test("the board envelope keeps the screener's freshness, as-of and market lane", async () => {
    const market = { strategies: () => recorded() } as unknown as MarketDataSource;
    const board = await strategyBoard([arjumScreenerSource(market)]);
    expect(board).toMatchObject({ freshness: "HISTORICAL", asOf: "2026-09-18", source: "fixture:arjum" });
    expect(board.data.candidates).toHaveLength(2);
    expect(strategyBoardSchema.safeParse(board.data).success).toBe(true);
  });
});
