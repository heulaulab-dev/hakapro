import { expect, test, vi } from "vitest";
import { withFreshness, type Freshness } from "@/lib/freshness";
import type { ScreenerCandidate, ScreenerStrategy, StrategySourceId } from "@/lib/strategies/contract";
import { strategyBoard, type StrategySource } from "./index";

function fakeSource(id: StrategySourceId, freshness: Freshness, asOf: string, strategyIds: string[]): StrategySource {
  const strategies: ScreenerStrategy[] = strategyIds.map((strategyId) => ({ id: strategyId, label: strategyId, description: null, source: id, kind: "EOD", dataAsOf: asOf, freshness }));
  const candidate = (strategyId: string): ScreenerCandidate => ({
    symbol: `${id}-${strategyId}`, name: null, strategyId, detectedAt: asOf, dataAsOf: asOf, freshness, score: null, reasons: [], metrics: [], source: id,
  });
  return {
    id,
    context: async () => withFreshness({ source: id, version: null, marketCondition: null, universe: null }, { freshness, asOf, source: id.toLowerCase() }),
    list: async () => strategies,
    candidates: async (strategyId) => (strategyIds.includes(strategyId) ? [candidate(strategyId)] : []),
  };
}

test("a board of several sources is as fresh as its stalest source and as of its oldest data", async () => {
  const board = await strategyBoard([
    fakeSource("ARJUM_SCREENER", "EOD", "2026-10-15", ["a"]),
    fakeSource("HAKAPRO_EOD_ENGINE", "STALE", "2026-10-10", ["b"]),
  ]);
  expect(board).toMatchObject({ freshness: "STALE", asOf: "2026-10-10", source: "arjum_screener+hakapro_eod_engine" });
  expect(board.data.contexts.map((context) => context.source)).toEqual(["ARJUM_SCREENER", "HAKAPRO_EOD_ENGINE"]);
  expect(board.data.candidates.map((candidate) => candidate.strategyId)).toEqual(["a", "b"]);
});

test("a source with no strategies doesn't make the board UNAVAILABLE; with no strategies anywhere, every source counts", async () => {
  const empty = { ...fakeSource("HAKAPRO_EOD_ENGINE", "UNAVAILABLE", "2026-10-15", []), context: async () => withFreshness({ source: "HAKAPRO_EOD_ENGINE" as const, version: null, marketCondition: null, universe: null }, { freshness: "UNAVAILABLE", asOf: null, source: "idx-bei" }) };
  const board = await strategyBoard([fakeSource("ARJUM_SCREENER", "EOD", "2026-10-15", ["a"]), empty]);
  expect(board).toMatchObject({ freshness: "EOD", asOf: "2026-10-15", source: "arjum_screener" });
  expect(board.data.contexts).toHaveLength(2);
  const none = await strategyBoard([fakeSource("ARJUM_SCREENER", "EOD", "2026-10-15", []), empty]);
  expect(none).toMatchObject({ freshness: "UNAVAILABLE" });
});

test("a strategy id already taken by an earlier source is skipped with its candidates, and logged", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const board = await strategyBoard([
    fakeSource("ARJUM_SCREENER", "EOD", "2026-10-15", ["shared"]),
    fakeSource("HAKAPRO_EOD_ENGINE", "EOD", "2026-10-15", ["shared", "own"]),
  ]);
  expect(board.data.strategies.map((strategy) => `${strategy.source}:${strategy.id}`)).toEqual(["ARJUM_SCREENER:shared", "HAKAPRO_EOD_ENGINE:own"]);
  expect(board.data.candidates.map((candidate) => candidate.symbol)).toEqual(["ARJUM_SCREENER-shared", "HAKAPRO_EOD_ENGINE-own"]);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('"event":"strategy_id_collision"'));
  warn.mockRestore();
});
