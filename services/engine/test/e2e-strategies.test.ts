// E4 strategy scans against a throwaway PostgreSQL (Docker): the synthetic fixture universe (test/strategy-fixtures.ts)
// seeded into daily_prices / securities / corporate_actions / eod_sessions, then strategy-scan-eod → scan_runs /
// scan_candidates → /v1/strategies, parsed by the shared HAKA-18 schema and by the app's IdxBeiSource.
// Opt-in (`bun run engine:test:e2e`); skipped in `bun run test` and CI. No request leaves the machine.
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { strategyBoardSchema } from "@/lib/strategies/contract";
import { idxBeiEnvelope } from "@/server/schemas/idx-bei";
import * as t from "../db/schema";
import { loadConfig } from "../src/config";
import type { EngineDb } from "../src/db/client";
import { createEngine, type EngineOptions } from "../src/engine";
import { strategyScanJob } from "../src/jobs/strategy-scan";
import { nullLogger } from "../src/log";
import { dockerEnabled, startPostgres, type TestPostgres } from "./postgres";
import { fixtureUniverse, SCAN_SESSION } from "./strategy-fixtures";
import { tempDir, wib } from "./support";

const enabled = dockerEnabled();
const boardEnvelope = idxBeiEnvelope(strategyBoardSchema);
const refuse = (async (input: string | URL | Request) => { throw new Error(`network refused in e2e: ${String(input)}`); }) as unknown as typeof fetch;

async function seed(db: EngineDb, status: "PARTIAL" | "COMPLETE") {
  const universe = fixtureUniverse();
  const asOf = new Date("2026-10-15T13:45:00Z");
  await db.insert(t.securities).values(universe.securities.map((security) => ({
    symbol: security.symbol, name: security.name ?? security.symbol, board: security.board, notation: security.notation, active: true, source: "test-fixture", asOf,
  })));
  // An inactive security is not part of the scanned universe.
  await db.insert(t.securities).values({ symbol: "DELI", name: "Delisted Fixture Tbk", active: false, source: "test-fixture", asOf });
  const rows = [...universe.bars.entries()].flatMap(([symbol, bars]) => bars.map((bar) => ({ symbol, ...bar, source: "test-fixture", asOf })));
  for (let i = 0; i < rows.length; i += 500) await db.insert(t.dailyPrices).values(rows.slice(i, i + 500));
  await db.insert(t.corporateActions).values([...universe.splitExDates.entries()].flatMap(([symbol, dates]) => dates.map((exDate) => ({
    symbol, type: "SPLIT", exDate, ratio: "1:2", description: "Stock split 1:2", source: "test-fixture", asOf,
  }))));
  await db.insert(t.eodSessions).values({ date: SCAN_SESSION, status, expected: 7, present: status === "COMPLETE" ? 7 : 6 });
}

describe.skipIf(!enabled)("strategy scans (docker postgres + synthetic universe)", () => {
  let pg: TestPostgres;
  const cleanups: Array<() => Promise<void>> = [];
  let counter = 0;

  beforeAll(async () => { pg = await startPostgres(); }, 120_000);
  afterAll(async () => {
    for (const cleanup of cleanups) await cleanup();
    pg?.stop();
  });

  async function harness(env: Record<string, string>, registry?: EngineOptions["registry"]) {
    const url = await pg.createDatabase(`strategies_${++counter}`);
    const dir = await tempDir("engine-strategies-");
    let now = wib(SCAN_SESSION, "21:00");
    const config = loadConfig({ ENGINE_DATABASE_URL: url, ENGINE_DATA_DIR: dir.path, ENGINE_ADMIN_TOKEN: "e2e-admin", ENGINE_DISK_STOP_PERCENT: "100", ...env });
    const engine = await createEngine(config, { fetch: refuse, log: nullLogger, now: () => now, registry });
    cleanups.push(async () => { await engine.shutdown(); await dir.cleanup(); });
    const call = async (path: string, init?: RequestInit) => engine.app(new Request(`http://engine.test${path}`, init));
    const runManual = async () => {
      const response = await call("/v1/admin/jobs/strategy-scan-eod/run", { method: "POST", headers: { authorization: "Bearer e2e-admin" } });
      expect(response.status).toBe(202);
      await engine.scheduler.waitFor("strategy-scan-eod");
      return engine.scheduler.status().find((job) => job.id === "strategy-scan-eod")!;
    };
    return { engine, db: engine.services.db, call, runManual, setNow: (at: Date) => { now = at; } };
  }
  const health = async (call: (path: string) => Promise<Response>) => ((await (await call("/v1/meta/health")).json()) as {
    data: { unavailable: Array<{ route: string; status: string }>; strategyScans: { enabled: boolean; runs: Array<{ sessionDate: string; status: string; skipReason: string | null; candidates: number }>; notBuilt: Array<{ id: string }> } };
  }).data;

  it("off by default: no job, the empty UNAVAILABLE board, and /v1/meta/health says why", async () => {
    const h = await harness({});
    await seed(h.db, "COMPLETE");
    expect(h.engine.scheduler.status().some((job) => job.id === "strategy-scan-eod")).toBe(false);
    expect((await h.engine.scheduler.trigger("strategy-scan-eod")).status).toBe("unknown_job");
    const body = boardEnvelope.parse(await (await h.call("/v1/strategies")).json());
    expect(body).toMatchObject({ data: { contexts: [], strategies: [], candidates: [] }, meta: { freshness: "UNAVAILABLE", dataAsOf: null } });
    const data = await health(h.call);
    expect(data.unavailable.find((row) => row.route === "/v1/strategies")?.status).toBe("DISABLED");
    expect(data.strategyScans).toMatchObject({ enabled: false, runs: [] });
    expect(data.strategyScans.notBuilt.map((row) => row.id)).toEqual(["ara-hunter", "haka-sore", "haka-pagi", "scalping-intraday"]);
  });

  it("skips a session whose EOD data is not COMPLETE, then scans it once it is", async () => {
    const h = await harness({ ENGINE_STRATEGY_SCANS_ENABLED: "1" });
    expect(h.engine.scheduler.status().find((job) => job.id === "strategy-scan-eod")?.trigger).toEqual({ kind: "cron", spec: "0 21,23 * * *", tradingDaysOnly: true });
    await seed(h.db, "PARTIAL");

    expect((await h.runManual()).lastStatus).toBe("SUCCEEDED");
    const skipped = await h.db.select().from(t.scanRuns);
    expect(skipped).toEqual([expect.objectContaining({ sessionDate: SCAN_SESSION, status: "SKIPPED", rulesVersion: "0.1-draft", skipReason: `EOD session ${SCAN_SESSION} is PARTIAL, not COMPLETE`, source: "HAKAPRO_EOD_ENGINE" })]);
    expect(boardEnvelope.parse(await (await h.call("/v1/strategies")).json()).meta.freshness).toBe("UNAVAILABLE");
    expect((await health(h.call)).strategyScans.runs[0]).toMatchObject({ status: "SKIPPED", skipReason: expect.stringContaining("PARTIAL") });

    await h.db.update(t.eodSessions).set({ status: "COMPLETE", present: 7 }).where(eq(t.eodSessions.date, SCAN_SESSION));
    expect((await h.runManual()).lastStatus).toBe("SUCCEEDED");

    const runs = await h.db.select().from(t.scanRuns);
    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run).toMatchObject({ sessionDate: SCAN_SESSION, status: "SUCCEEDED", skipReason: null, covered: 7, eligible: 3, skipped: 4, candidateCount: 2, source: "HAKAPRO_EOD_ENGINE" });
    expect(run.gateFailures).toMatchObject({ G2: 1, G4: 1, G7: 1, G8: 1 });
    expect(run.parameters).toMatchObject({ rulesVersion: "0.1-draft", breakout: { lookback: 20, minRelativeVolume: 2 }, bbReversal: { period: 20, stdDevs: 2 } });
    expect(run.jobRunId).toBeTruthy();

    const candidates = await h.db.select().from(t.scanCandidates).orderBy(asc(t.scanCandidates.strategyId));
    expect(candidates.map((row) => [row.strategyId, row.symbol, row.rank, row.sessionDate, row.rulesVersion, row.source])).toEqual([
      ["bb-reversal", "BBRV", 0, SCAN_SESSION, "0.1-draft", "HAKAPRO_EOD_ENGINE"],
      ["breakout", "BRKT", 0, SCAN_SESSION, "0.1-draft", "HAKAPRO_EOD_ENGINE"],
    ]);
    expect(candidates.every((row) => row.asOf.getTime() === run.asOf.getTime() && row.reasons.length > 0 && row.metrics.length > 0)).toBe(true);

    const body = boardEnvelope.parse(await (await h.call("/v1/strategies")).json());
    expect(body.meta).toMatchObject({ dataAsOf: SCAN_SESSION, freshness: "EOD" });
    expect(body.data.strategies.map((strategy) => strategy.id)).toEqual(["breakout", "bb-reversal"]);
    expect(body.data.candidates.map((candidate) => `${candidate.strategyId}:${candidate.symbol}:${candidate.score}`)).toEqual(["breakout:BRKT:null", "bb-reversal:BBRV:null"]);
    expect(body.data.contexts[0]).toMatchObject({ source: "HAKAPRO_EOD_ENGINE", version: "0.1-draft", universe: { covered: 7, liquid: 3, skipped: 4 } });
    expect((await health(h.call)).strategyScans.runs[0]).toMatchObject({ sessionDate: SCAN_SESSION, status: "SUCCEEDED", candidates: 2 });
  });

  it("a scheduled run leaves a scanned session alone; a manual run recomputes it in place", async () => {
    // Only the scan job, so ticks at 21:00/23:00 launch nothing that would reach for a source.
    const h = await harness({ ENGINE_STRATEGY_SCANS_ENABLED: "1" }, (services) => ({ sources: [], jobs: [strategyScanJob(services)] }));
    await seed(h.db, "COMPLETE");
    expect((await h.engine.scheduler.tick(wib(SCAN_SESSION, "21:00")))).toContain("strategy-scan-eod");
    await h.engine.scheduler.waitFor("strategy-scan-eod");
    const [first] = await h.db.select().from(t.scanRuns);
    expect(first.status).toBe("SUCCEEDED");

    h.setNow(wib(SCAN_SESSION, "23:00"));
    expect((await h.engine.scheduler.tick(wib(SCAN_SESSION, "23:00")))).toContain("strategy-scan-eod");
    await h.engine.scheduler.waitFor("strategy-scan-eod");
    const [again] = await h.db.select().from(t.scanRuns);
    expect(again).toMatchObject({ id: first.id, asOf: first.asOf });

    h.setNow(wib(SCAN_SESSION, "23:30"));
    await h.runManual();
    const rerun = await h.db.select().from(t.scanRuns);
    expect(rerun).toHaveLength(1);
    expect(rerun[0].id).not.toBe(first.id);
    expect(rerun[0].asOf.toISOString()).toBe(wib(SCAN_SESSION, "23:30").toISOString());
    expect(await h.db.select().from(t.scanCandidates)).toHaveLength(2);

    // Non-trading days never schedule the scan (Saturday 21:00).
    expect(await h.engine.scheduler.tick(wib("2026-10-17", "21:00"))).not.toContain("strategy-scan-eod");
  });
});
