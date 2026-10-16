import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { strategyBoardSchema } from "@/lib/strategies/contract";
import { idxBeiEnvelope } from "@/server/schemas/idx-bei";
import { fixtureStrategyStore, SCAN_SESSION } from "../../test/strategy-fixtures";
import { tempDir } from "../../test/support";
import { MemoryCursorStore, MemoryRunRecorder, MemorySourceStateStore } from "../fetch/stores";
import { createApp, type AppDeps } from "../http/app";
import { PauseGuard } from "../schedule/pause";
import { Scheduler } from "../schedule/scheduler";
import { MemoryStrategyStore } from "./strategies";

const BASE = "http://engine.test";
const boardEnvelope = idxBeiEnvelope(strategyBoardSchema);
type Health = {
  unavailable: Array<{ route: string; status: string; reason: string }>;
  strategyScans: { enabled: boolean; rulesVersion: string; rulesStatus: string; built: Array<{ id: string; status: string }>; notBuilt: Array<{ id: string; label: string; status: string; reason: string }>; runs: Array<Record<string, unknown>> };
};

describe("/v1/strategies", () => {
  let dir: Awaited<ReturnType<typeof tempDir>>;
  beforeEach(async () => { dir = await tempDir(); });
  afterEach(async () => { await dir.cleanup(); });

  /** Engine clock: 2026-10-15 21:30 WIB, after the session closed. */
  function call(strategies: AppDeps["strategies"], now = new Date("2026-10-15T14:30:00Z")) {
    const pause = new PauseGuard(dir.path, 85, { cacheMs: 0, measure: async () => 10 });
    const scheduler = new Scheduler({ jobs: [], pause, runs: new MemoryRunRecorder(), cursors: new MemoryCursorStore(), sourceState: new MemorySourceStateStore() });
    const app = createApp({ ping: async () => true, pause, scheduler, rawStoreKind: "local", sourceHealth: async () => [], unblockSource: async () => false, now: () => now, strategies });
    return async (path: string) => app(new Request(`${BASE}${path}`));
  }

  it("is the empty UNAVAILABLE board while ENGINE_STRATEGY_SCANS_ENABLED is off, even with stored runs, and health says why", async () => {
    for (const strategies of [undefined, { enabled: false, store: fixtureStrategyStore() }]) {
      const get = call(strategies);
      const body = boardEnvelope.parse(await (await get("/v1/strategies")).json());
      expect(body.data).toEqual({ contexts: [], strategies: [], candidates: [] });
      expect(body.meta).toMatchObject({ freshness: "UNAVAILABLE", dataAsOf: null });
      const health = ((await (await get("/v1/meta/health")).json()) as { data: Health }).data;
      expect(health.unavailable.find((row) => row.route === "/v1/strategies")).toMatchObject({ status: "DISABLED", reason: expect.stringContaining("ENGINE_STRATEGY_SCANS_ENABLED") });
      expect(health.strategyScans).toMatchObject({ enabled: false, rulesVersion: "0.1-draft", rulesStatus: "DRAFT_NOT_APPROVED" });
    }
  });

  it("lists the built and the not-built draft strategies on /v1/meta/health", async () => {
    const health = ((await (await call({ enabled: true, store: fixtureStrategyStore() })("/v1/meta/health")).json()) as { data: Health }).data;
    expect(health.unavailable.find((row) => row.route === "/v1/strategies")).toBeUndefined();
    expect(health.strategyScans.built.map((row) => `${row.id}:${row.status}`)).toEqual(["breakout:BUILT", "bb-reversal:BUILT"]);
    expect(health.strategyScans.notBuilt.map((row) => `${row.label}:${row.status}`)).toEqual([
      "ARA HUNTER:NOT_BUILT", "HAKA SORE / BSJP:NOT_BUILT", "HAKA PAGI:NOT_BUILT", "SCALPING INTRADAY:NOT_BUILT",
    ]);
    expect(health.strategyScans.notBuilt.every((row) => /HAKA-25|HAKA-14\/15/.test(row.reason))).toBe(true);
    expect(health.strategyScans.runs).toEqual([expect.objectContaining({ sessionDate: SCAN_SESSION, status: "SUCCEEDED", candidates: 2, covered: 7, eligible: 3 })]);
  });

  it("is the empty UNAVAILABLE board when enabled before the first scan", async () => {
    const body = boardEnvelope.parse(await (await call({ enabled: true, store: new MemoryStrategyStore() })("/v1/strategies")).json());
    expect(body).toMatchObject({ data: { contexts: [], strategies: [], candidates: [] }, meta: { freshness: "UNAVAILABLE", dataAsOf: null } });
  });

  it("serves the latest scan in the HAKA-18 contract shape: EOD, score null, criteria and notes, metrics with units", async () => {
    const response = await call({ enabled: true, store: fixtureStrategyStore() })("/v1/strategies");
    expect(response.status).toBe(200);
    const { data, meta } = boardEnvelope.parse(await response.json());
    expect(meta).toMatchObject({ source: "hakapro-engine", dataAsOf: SCAN_SESSION, freshness: "EOD" });
    expect(data.contexts).toEqual([{ source: "HAKAPRO_EOD_ENGINE", version: "0.1-draft", marketCondition: null, universe: { covered: 7, liquid: 3, skipped: 4 } }]);
    expect(data.strategies.map((strategy) => [strategy.id, strategy.label, strategy.kind, strategy.source, strategy.freshness])).toEqual([
      ["breakout", "BREAKOUT", "EOD", "HAKAPRO_EOD_ENGINE", "EOD"], ["bb-reversal", "BB REVERSAL", "EOD", "HAKAPRO_EOD_ENGINE", "EOD"],
    ]);
    expect(data.candidates.map((candidate) => `${candidate.strategyId}:${candidate.symbol}`)).toEqual(["breakout:BRKT", "bb-reversal:BBRV"]);
    const [breakout, band] = data.candidates;
    expect(breakout).toMatchObject({ name: "Breakout Fixture Tbk", score: null, dataAsOf: SCAN_SESSION, detectedAt: "2026-10-15T14:00:00.000Z", freshness: "EOD", source: "HAKAPRO_EOD_ENGINE" });
    expect(breakout.reasons.filter((reason) => reason.kind === "criterion").map((reason) => reason.kind === "criterion" && reason.key)).toEqual(["closeAboveHigh", "relativeVolume", "closeLocation", "firstBreak"]);
    expect(breakout.reasons.some((reason) => reason.kind === "note" && reason.text.includes("Draft rules 0.1-draft"))).toBe(true);
    expect(breakout.metrics.find((metric) => metric.key === "relativeVolume")).toEqual({ key: "relativeVolume", value: 3, unit: "ratio" });
    expect(breakout.metrics.find((metric) => metric.key === "atUpperLimit")).toEqual({ key: "atUpperLimit", value: null, unit: "count" });
    expect(band.reasons.filter((reason) => reason.kind === "criterion").map((reason) => reason.kind === "criterion" && reason.key)).toEqual(["closedBelowBand", "backInsideBand", "bullishCandle"]);
    expect(band.metrics.map((metric) => metric.unit)).toContain("percent");
  });

  it("labels an older session STALE", async () => {
    const { meta, data } = boardEnvelope.parse(await (await call({ enabled: true, store: fixtureStrategyStore() }, new Date("2026-10-19T12:00:00Z"))("/v1/strategies")).json());
    expect(meta.freshness).toBe("STALE");
    expect(data.candidates.every((candidate) => candidate.freshness === "STALE")).toBe(true);
  });
});
