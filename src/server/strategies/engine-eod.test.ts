import { afterEach, describe, expect, test, vi } from "vitest";
import { withFreshness } from "@/lib/freshness";
import { strategyBoardSchema, type StrategyBoard } from "@/lib/strategies/contract";
import type { MarketDataSource } from "@/server/market";
import { MarketDataError } from "@/server/market/errors";
import { engineStrategySource, fromEngineBoard, type EngineStrategyClient } from "./engine-eod";
import { strategyBoard, strategySources } from "./index";

/** A `/v1/strategies` board as the Data Engine serves it (draft rules 0.1-draft, session 2026-10-15). */
const FIXTURE_BOARD: StrategyBoard = strategyBoardSchema.parse({
  contexts: [{ source: "HAKAPRO_EOD_ENGINE", version: "0.1-draft", marketCondition: null, universe: { covered: 955, liquid: 412, skipped: 543 } }],
  strategies: [
    { id: "breakout", label: "BREAKOUT", description: "Closed above the highest price of the previous 20 sessions …", source: "HAKAPRO_EOD_ENGINE", kind: "EOD", dataAsOf: "2026-10-15", freshness: "EOD" },
    { id: "bb-reversal", label: "BB REVERSAL", description: "Closed below the lower Bollinger band (20, 2) …", source: "HAKAPRO_EOD_ENGINE", kind: "EOD", dataAsOf: "2026-10-15", freshness: "EOD" },
  ],
  candidates: [
    {
      symbol: "BRKT", name: "Breakout Fixture Tbk", strategyId: "breakout", detectedAt: "2026-10-15T14:00:00.000Z", dataAsOf: "2026-10-15", freshness: "EOD", score: null,
      reasons: [{ kind: "criterion", key: "closeAboveHigh" }, { kind: "criterion", key: "relativeVolume" }, { kind: "note", text: "Draft rules 0.1-draft (HAKA-17), not yet approved by the owner." }],
      metrics: [{ key: "breakoutPercent", value: 6.93, unit: "percent" }, { key: "relativeVolume", value: 3, unit: "ratio" }, { key: "atUpperLimit", value: null, unit: "count" }],
      source: "HAKAPRO_EOD_ENGINE",
    },
    {
      symbol: "BBRV", name: "Band Fixture Tbk", strategyId: "bb-reversal", detectedAt: "2026-10-15T14:00:00.000Z", dataAsOf: "2026-10-15", freshness: "EOD", score: null,
      reasons: [{ kind: "criterion", key: "closedBelowBand" }, { kind: "criterion", key: "backInsideBand" }, { kind: "criterion", key: "bullishCandle" }],
      metrics: [{ key: "percentB", value: 0.21, unit: "ratio" }],
      source: "HAKAPRO_EOD_ENGINE",
    },
    // Defensive: anything not from the EOD engine, or for a strategy the board doesn't list, is dropped.
    { symbol: "XXXX", name: null, strategyId: "unknown", detectedAt: null, dataAsOf: null, freshness: "EOD", score: 9, reasons: [], metrics: [], source: "HAKAPRO_EOD_ENGINE" },
  ],
});

/** The app re-derives freshness from the lane's dataAsOf; here the session is already a day old. */
const lane = (board: StrategyBoard = FIXTURE_BOARD) => withFreshness(board, { freshness: "STALE", asOf: "2026-10-15", source: "idx-bei" });
const client = (board?: StrategyBoard): EngineStrategyClient & { engineStrategies: ReturnType<typeof vi.fn> } => ({ engineStrategies: vi.fn(async () => lane(board)) });

describe("fromEngineBoard", () => {
  test("prefixes ids, keeps the engine's reasons and metrics, and takes freshness from the lane envelope", () => {
    const { context, strategies, candidates } = fromEngineBoard(lane());
    expect(context).toEqual(FIXTURE_BOARD.contexts[0]);
    expect(strategies.map((strategy) => [strategy.id, strategy.label, strategy.source, strategy.freshness, strategy.dataAsOf])).toEqual([
      ["eod-breakout", "BREAKOUT", "HAKAPRO_EOD_ENGINE", "STALE", "2026-10-15"],
      ["eod-bb-reversal", "BB REVERSAL", "HAKAPRO_EOD_ENGINE", "STALE", "2026-10-15"],
    ]);
    expect(candidates.map((candidate) => `${candidate.strategyId}:${candidate.symbol}:${candidate.freshness}:${candidate.score}`)).toEqual([
      "eod-breakout:BRKT:STALE:null", "eod-bb-reversal:BBRV:STALE:null",
    ]);
    expect(candidates[0].reasons).toEqual(FIXTURE_BOARD.candidates[0].reasons);
    expect(candidates[0].metrics).toEqual(FIXTURE_BOARD.candidates[0].metrics);
    expect(strategyBoardSchema.safeParse({ contexts: [context], strategies, candidates }).success).toBe(true);
  });

  test("an engine board without a context still yields one, stating nothing", () => {
    expect(fromEngineBoard(lane({ ...FIXTURE_BOARD, contexts: [] })).context).toEqual({ source: "HAKAPRO_EOD_ENGINE", version: null, marketCondition: null, universe: null });
  });
});

describe("engineStrategySource", () => {
  afterEach(() => vi.restoreAllMocks());

  test("list and candidates for every strategy cost one engine request", async () => {
    const engine = client();
    const source = engineStrategySource(() => engine);
    const list = await source.list();
    for (const strategy of list) await source.candidates(strategy.id);
    expect((await source.context()).data.version).toBe("0.1-draft");
    expect(engine.engineStrategies).toHaveBeenCalledTimes(1);
    expect((await source.candidates("eod-breakout")).map((candidate) => candidate.symbol)).toEqual(["BRKT"]);
    expect(await source.candidates("breakout")).toEqual([]);
  });

  test("an unconfigured or failing engine contributes nothing, as UNAVAILABLE, and is logged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const source = engineStrategySource(() => { throw new MarketDataError("NOT_CONFIGURED", "Market data service is not configured", 503); });
    expect(await source.list()).toEqual([]);
    expect(await source.context()).toMatchObject({ freshness: "UNAVAILABLE", asOf: null, data: { source: "HAKAPRO_EOD_ENGINE", universe: null } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"code":"NOT_CONFIGURED"'));
  });
});

describe("strategySources registration (STRATEGY_ENGINE_ENABLED)", () => {
  const arjumBoard = {
    data: {
      date: "2026-10-15", screenerVersion: "V5.2", marketCondition: null, universe: null,
      strategies: [{ id: "akumulasi-senyap", name: "AKUMULASI SENYAP", description: null, matches: [{ symbol: "SOCI", name: "Soechi Lines Tbk.", criteria: [], pattern: null, notes: [] }] }],
    },
    freshness: "EOD" as const, asOf: "2026-10-15", source: "fixture:arjum",
  };
  const market = { strategies: async () => arjumBoard } as unknown as MarketDataSource;

  test("off by default: only the arjum screener is registered", () => {
    expect(strategySources(market, {}).map((source) => source.id)).toEqual(["ARJUM_SCREENER"]);
    expect(strategySources(market, { STRATEGY_ENGINE_ENABLED: "true" }).map((source) => source.id)).toEqual(["ARJUM_SCREENER"]);
  });

  test("with STRATEGY_ENGINE_ENABLED=1 the engine follows arjum; the board keeps arjum's freshness when the engine is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = () => ({ engineStrategies: async () => { throw new MarketDataError("PROVIDER_UNAVAILABLE", "down", 503); } });
    const sources = strategySources(market, { STRATEGY_ENGINE_ENABLED: "1" }, failing);
    expect(sources.map((source) => source.id)).toEqual(["ARJUM_SCREENER", "HAKAPRO_EOD_ENGINE"]);
    const board = await strategyBoard(sources);
    expect(board).toMatchObject({ freshness: "EOD", asOf: "2026-10-15", source: "fixture:arjum" });
    expect(board.data.strategies.map((strategy) => strategy.id)).toEqual(["akumulasi-senyap"]);
    expect(board.data.contexts.map((context) => context.source)).toEqual(["ARJUM_SCREENER", "HAKAPRO_EOD_ENGINE"]);
  });

  test("with a reachable engine both sources merge without id collisions", async () => {
    const engine = client();
    const board = await strategyBoard(strategySources(market, { STRATEGY_ENGINE_ENABLED: "1" }, () => engine));
    expect(board.data.strategies.map((strategy) => `${strategy.source}:${strategy.id}`)).toEqual([
      "ARJUM_SCREENER:akumulasi-senyap", "HAKAPRO_EOD_ENGINE:eod-breakout", "HAKAPRO_EOD_ENGINE:eod-bb-reversal",
    ]);
    expect(board).toMatchObject({ freshness: "STALE", asOf: "2026-10-15" });
    expect(strategyBoardSchema.safeParse(board.data).success).toBe(true);
  });
});
