// E2/E2b jobs and the /v1 routes against a throwaway PostgreSQL (Docker) and the local source fixtures.
// Opt-in (`bun run engine:test:e2e`); skipped in `bun run test` and CI. No request leaves the machine: the fixture
// world refuses any URL it does not serve, and arjum is a fake.
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { actionsSchema, idxBeiEnvelope, marketOverviewSchema, securitySchema, signalsSchema, stockSchema } from "@/server/schemas/idx-bei";
import * as t from "../db/schema";
import { loadConfig } from "../src/config";
import { createEngine } from "../src/engine";
import { ENGINE_USER_AGENT } from "../src/fetch/fetcher";
import { LimiterRegistry } from "../src/fetch/rate-limit";
import { nullLogger } from "../src/log";
import { dockerEnabled, startPostgres, type TestPostgres } from "./postgres";
import { ARJUM_TEST_KEY, ARJUM_TEST_ORIGIN, startSourceWorld, type SourceWorld } from "./source-fixtures";
import { fakeClock, tempDir, wib } from "./support";

const enabled = dockerEnabled();
const TV_SYMBOLS = ["BBCA", "BBRI", "BMRI", "TLKM", "GOTO"];
const PASARDANA_SYMBOLS = ["AADI", "AALI", "ABBA"];

describe.skipIf(!enabled)("engine sources (docker postgres + fixtures)", () => {
  let pg: TestPostgres;
  let world: SourceWorld;
  const cleanups: Array<() => Promise<void>> = [];
  let counter = 0;

  beforeAll(async () => {
    pg = await startPostgres();
    world = await startSourceWorld();
  }, 120_000);

  afterAll(async () => {
    for (const cleanup of cleanups) await cleanup();
    await world?.close();
    pg?.stop();
  });

  beforeEach(() => {
    world.hits.length = 0;
    world.state.blocked.clear();
    world.state.tvPriceFactor = 1;
    world.state.arjumRemaining = 1000;
  });

  /** A fresh database and engine; the clock is controlled, rate limits run on a virtual clock. */
  async function harness(env: Record<string, string> = {}) {
    const url = await pg.createDatabase(`engine_${++counter}`);
    const dir = await tempDir("engine-sources-");
    const clock = fakeClock(0);
    let now = wib("2026-10-16", "16:40");
    const config = loadConfig({
      ENGINE_DATABASE_URL: url, ENGINE_DATA_DIR: dir.path, ENGINE_ADMIN_TOKEN: "e2e-admin", ENGINE_DISK_STOP_PERCENT: "100",
      ENGINE_ARJUM_BASE_URL: ARJUM_TEST_ORIGIN, ENGINE_ARJUM_API_KEY: ARJUM_TEST_KEY, ...env,
    });
    const engine = await createEngine(config, { fetch: world.fetch, log: nullLogger, now: () => now, limiters: new LimiterRegistry(clock) });
    cleanups.push(async () => { await engine.shutdown(); await dir.cleanup(); });
    const run = async (id: string, expected = "started") => {
      const outcome = await engine.scheduler.trigger(id);
      expect(outcome.status, id).toBe(expected);
      await engine.scheduler.waitFor(id);
      return engine.scheduler.status().find((job) => job.id === id)!;
    };
    const call = async (path: string) => engine.app(new Request(`http://engine.test${path}`));
    return { engine, db: engine.services.db, clock, run, call, setNow: (at: Date) => { now = at; } };
  }

  it("registers the E2/E2b sources and jobs with their schedules", async () => {
    const h = await harness();
    expect(h.engine.registry.sources.map((source) => [source.id, source.host, source.policy])).toEqual([
      ["tradingview-scanner", "scanner.tradingview.com", { minIntervalMs: 2000, concurrency: 1 }],
      ["yahoo-chart", "query1.finance.yahoo.com", { minIntervalMs: 3000, concurrency: 1 }],
      ["pasardana", "pasardana.id", { minIntervalMs: 3000, concurrency: 1 }],
      ["arjum", "arjum.example.test", { minIntervalMs: 2000, concurrency: 1 }],
    ]);
    expect(Object.fromEntries(h.engine.scheduler.status().map((job) => [job.id, job.trigger]))).toEqual({
      universe: { kind: "cron", spec: "35 16 * * *", tradingDaysOnly: true },
      "indices-eod": { kind: "cron", spec: "35 16 * * *", tradingDaysOnly: true },
      "eod-daily": { kind: "cron", spec: "45 16,18,20 * * *", tradingDaysOnly: true },
      "eod-backfill": { kind: "cron", spec: "*/10 19-23,0-5 * * *" },
      "foreign-flow": { kind: "cron", spec: "0 19,21 * * *", tradingDaysOnly: true },
      intraday: { kind: "session", everyMinutes: 5 },
      "intraday-retention": { kind: "cron", spec: "30 2 * * *" },
    });
  });

  it("universe: TradingView + Pasardana → securities and fallback session rows with provenance", async () => {
    const h = await harness();
    expect((await h.run("universe")).lastStatus).toBe("SUCCEEDED");
    const securities = await h.db.select().from(t.securities).orderBy(asc(t.securities.symbol));
    expect(securities.map((row) => row.symbol)).toEqual([...PASARDANA_SYMBOLS, ...TV_SYMBOLS].sort());
    expect(securities.every((row) => row.active && row.board === null && row.notation === null && row.rawRef && row.source && row.asOf)).toBe(true);
    expect(securities.find((row) => row.symbol === "AADI")).toMatchObject({ name: "Adaro Andalan Indonesia Tbk.", sector: "Energi", freeFloatPct: 18.18, sharesOutstanding: 7786891760, source: "pasardana" });
    expect(securities.find((row) => row.symbol === "BBCA")).toMatchObject({ name: "PT Bank Central Asia Tbk", sector: "Finance", source: "tradingview-scanner" });

    const session = await h.db.select().from(t.dailyPrices).where(eq(t.dailyPrices.date, "2026-10-16")).orderBy(asc(t.dailyPrices.symbol));
    expect(session.map((row) => row.symbol)).toEqual([...TV_SYMBOLS].sort());
    expect(session.find((row) => row.symbol === "BBCA")).toMatchObject({ close: 5225, previousClose: 6075, volume: 994464400, value: 5196076490000, source: "tradingview-scanner", valueSource: "tradingview-scanner" });
    const previous = await h.db.select().from(t.dailyPrices).where(eq(t.dailyPrices.date, "2026-10-15"));
    expect(previous.find((row) => row.symbol === "AADI")).toMatchObject({ close: 11300, frequency: 5707, value: 70842097500, source: "pasardana", valueSource: "pasardana" });

    const docs = await h.db.select().from(t.rawDocuments);
    expect(docs.map((doc) => doc.source).sort()).toEqual(["pasardana", "tradingview-scanner"]);
    expect(docs.every((doc) => doc.parseStatus === "PARSED")).toBe(true);
    expect(docs.find((doc) => doc.source === "tradingview-scanner")!.url).toMatch(/^https:\/\/scanner\.tradingview\.com\/indonesia\/scan#post-/);
    expect(world.hits.every((hit) => hit.userAgent === ENGINE_USER_AGENT)).toBe(true);
    expect(world.hits.map((hit) => `${hit.source} ${hit.method}`)).toEqual(["tradingview POST", "pasardana GET"]);
  });

  it("universe falls back to Pasardana when TradingView blocks; the block is evidenced and never retried", async () => {
    const h = await harness();
    world.state.blocked.add("tradingview");
    expect((await h.run("universe")).lastStatus).toBe("SUCCEEDED");
    expect(world.hits.filter((hit) => hit.source === "tradingview")).toHaveLength(1);
    const [tv] = await h.db.select().from(t.sources).where(eq(t.sources.id, "tradingview-scanner"));
    expect(tv).toMatchObject({ status: "BLOCKED", blockEvidence: { reason: "CDN_FORBIDDEN", status: 403, headers: { "x-cache": "Error from cloudfront" } } });
    expect((await h.db.select().from(t.securities)).map((row) => row.symbol).sort()).toEqual(PASARDANA_SYMBOLS);
    // Jobs bound to TradingView refuse to start until an admin unblocks it.
    await h.run("intraday", "blocked");
    await h.run("indices-eod", "blocked");
    expect(world.hits.filter((hit) => hit.source === "tradingview")).toHaveLength(1);
    // Both sources blocked: the run itself is BLOCKED.
    world.state.blocked.add("pasardana");
    expect((await h.run("universe")).lastStatus).toBe("BLOCKED");
  });

  it("universe before the close updates the universe but writes no session row", async () => {
    const h = await harness();
    h.setNow(wib("2026-10-16", "11:00"));
    await h.run("universe");
    expect(await h.db.select().from(t.dailyPrices).where(eq(t.dailyPrices.date, "2026-10-16"))).toEqual([]);
    expect((await h.db.select().from(t.securities)).length).toBe(8);
  });

  it("eod-daily: Yahoo overwrites fallback OHLC but keeps value, skips unknown symbols, spaces calls, retries, then marks STALE", async () => {
    const h = await harness();
    await h.run("universe");
    h.setNow(wib("2026-10-16", "16:45"));
    expect((await h.run("eod-daily")).lastStatus).toBe("SUCCEEDED");
    const bbca = await h.db.select().from(t.dailyPrices).where(eq(t.dailyPrices.symbol, "BBCA")).orderBy(asc(t.dailyPrices.date));
    expect(bbca.map((row) => row.date)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(bbca.at(-1)).toMatchObject({ close: 5225, volume: 999771300, adjClose: 5225, source: "yahoo-chart", value: 5196076490000, valueSource: "tradingview-scanner" });
    const yahooCalls = world.hits.filter((hit) => hit.source === "yahoo");
    expect(yahooCalls[0].path).toMatch(/^\/v8\/finance\/chart\/%5EJKSE\?range=5d/);
    // Most liquid first (by the session's value), every active symbol once.
    expect(yahooCalls.slice(1).map((hit) => decodeURIComponent(hit.path.split("?")[0].split("/").pop()!))).toEqual(["BBCA.JK", "BBRI.JK", "BMRI.JK", "TLKM.JK", "GOTO.JK", "AADI.JK", "AALI.JK", "ABBA.JK"]);
    expect(h.clock.sleeps.filter((ms) => ms > 2000).length).toBeGreaterThanOrEqual(7); // 3 s spacing on the Yahoo host
    const ihsg = await h.db.select().from(t.indexDaily).where(eq(t.indexDaily.code, "COMPOSITE"));
    expect(ihsg.length).toBeGreaterThanOrEqual(4);
    expect(ihsg.every((row) => row.source === "yahoo-chart")).toBe(true);
    let [session] = await h.db.select().from(t.eodSessions).where(eq(t.eodSessions.date, "2026-10-16"));
    expect(session).toMatchObject({ status: "PARTIAL", expected: 8, present: 5, attempts: 1, finalizedAt: null });

    // 20:45 attempt: only the symbols still missing a Yahoo row are requested; the session is then final and STALE.
    world.hits.length = 0;
    h.setNow(wib("2026-10-16", "20:45"));
    await h.run("eod-daily");
    expect(world.hits.some((hit) => hit.path.includes("BBCA.JK"))).toBe(false);
    [session] = await h.db.select().from(t.eodSessions).where(eq(t.eodSessions.date, "2026-10-16"));
    expect(session).toMatchObject({ status: "STALE", expected: 8, present: 5, attempts: 2 });
    expect(session.finalizedAt).not.toBeNull();
  });

  it("eod-daily stops on a Yahoo block and still records the session state", async () => {
    const h = await harness();
    await h.run("universe");
    world.state.blocked.add("yahoo");
    h.setNow(wib("2026-10-16", "16:45"));
    await h.run("eod-daily");
    expect(world.hits.filter((hit) => hit.source === "yahoo")).toHaveLength(1);
    const [yahoo] = await h.db.select().from(t.sources).where(eq(t.sources.id, "yahoo-chart"));
    expect(yahoo.status).toBe("BLOCKED");
    // TradingView's fallback rows still serve the session.
    const [session] = await h.db.select().from(t.eodSessions);
    expect(session).toMatchObject({ status: "PARTIAL", present: 5 });
  });

  it("indices-eod: TradingView is the primary index row; Yahoo IHSG only fills gaps", async () => {
    const h = await harness();
    await h.run("indices-eod");
    const rows = await h.db.select().from(t.indexDaily).orderBy(asc(t.indexDaily.code));
    expect(rows).toHaveLength(9);
    expect(rows.find((row) => row.code === "COMPOSITE")).toMatchObject({ date: "2026-10-16", close: 5232.855, previousClose: 5863.78, name: "IDX Composite Index", source: "tradingview-scanner" });
    await h.run("universe");
    h.setNow(wib("2026-10-16", "16:45"));
    await h.run("eod-daily");
    const ihsg = await h.db.select().from(t.indexDaily).where(eq(t.indexDaily.code, "COMPOSITE")).orderBy(asc(t.indexDaily.date));
    expect(ihsg.at(-1)).toMatchObject({ date: "2026-10-16", source: "tradingview-scanner", close: 5232.855 });
    expect(ihsg.slice(0, -1).every((row) => row.source === "yahoo-chart")).toBe(true);
  });

  it("eod-backfill: one call per symbol from 2020-01-01, resumable, with splits and dividends", async () => {
    const h = await harness();
    await h.run("universe");
    h.setNow(wib("2026-10-16", "19:10"));
    expect((await h.run("eod-backfill")).lastStatus).toBe("SUCCEEDED");
    const calls = world.hits.filter((hit) => hit.source === "yahoo");
    expect(calls).toHaveLength(9);
    expect(calls[0].path).toBe(`/v8/finance/chart/%5EJKSE?period1=${Date.parse("2020-01-01T00:00:00+07:00") / 1000}&period2=${Date.parse("2026-10-16T00:00:00+07:00") / 1000}&interval=1d&events=div%2Csplit`);
    const actions = await h.db.select().from(t.corporateActions).orderBy(asc(t.corporateActions.exDate));
    expect(actions.map((row) => [row.symbol, row.type, row.exDate, row.ratio, row.amount, row.source])).toEqual([
      ["BBCA", "SPLIT", "2021-10-13", "5:1", null, "yahoo-chart"],
      ["BBCA", "DIVIDEND", "2021-11-17", null, 25, "yahoo-chart"],
    ]);
    expect(await h.db.select().from(t.dailyPrices).where(and(eq(t.dailyPrices.symbol, "BBCA"), eq(t.dailyPrices.date, "2021-10-13")))).toHaveLength(1);
    const [cursor] = await h.db.select().from(t.jobCursors).where(eq(t.jobCursors.jobId, "eod-backfill"));
    expect(cursor.cursor).toMatchObject({ from: "2020-01-01", remaining: 0 });
    expect((cursor.cursor.done as string[]).sort()).toEqual(["^JKSE", ...PASARDANA_SYMBOLS, ...TV_SYMBOLS].sort());
    world.hits.length = 0;
    await h.run("eod-backfill");
    expect(world.hits).toEqual([]);
  });

  it("foreign-flow: most liquid first, API key sent, daily budget across runs, unknown codes skipped", async () => {
    const h = await harness({ ENGINE_ARJUM_DAILY_BUDGET: "3" });
    await h.run("universe");
    h.setNow(wib("2026-10-16", "19:00"));
    expect((await h.run("foreign-flow")).lastStatus).toBe("SUCCEEDED");
    const calls = world.hits.filter((hit) => hit.source === "arjum");
    expect(calls.map((hit) => hit.path)).toEqual(["/api/history/BBCA?limit=20", "/api/history/BBRI?limit=20", "/api/history/BMRI?limit=20"]);
    expect(calls.every((hit) => hit.apiKey === ARJUM_TEST_KEY && hit.userAgent === ENGINE_USER_AGENT)).toBe(true);
    const [bbca] = await h.db.select().from(t.dailyPrices).where(and(eq(t.dailyPrices.symbol, "BBCA"), eq(t.dailyPrices.date, "2026-10-16")));
    expect(bbca).toMatchObject({ foreignBuy: 310000000, foreignSell: 420000000, foreignSource: "arjum", source: "tradingview-scanner", value: 5196076490000 });
    expect(bbca.foreignRawRef).not.toBeNull();
    // Sessions arjum knows that no other source wrote become arjum rows (fallback), with foreign flow.
    const [older] = await h.db.select().from(t.dailyPrices).where(and(eq(t.dailyPrices.symbol, "BBCA"), eq(t.dailyPrices.date, "2026-10-14")));
    expect(older).toMatchObject({ source: "arjum", close: 6125, frequency: 28900, foreignBuy: 80000000 });
    const docs = await h.db.select().from(t.rawDocuments).where(eq(t.rawDocuments.source, "arjum"));
    expect(JSON.stringify(docs)).not.toContain(ARJUM_TEST_KEY);

    // The budget is per WIB day: the 21:00 run has nothing left; the next day starts again.
    h.setNow(wib("2026-10-16", "21:00"));
    world.hits.length = 0;
    await h.run("foreign-flow");
    expect(world.hits).toEqual([]);
    h.setNow(wib("2026-10-19", "19:00"));
    await h.run("foreign-flow");
    expect(world.hits.filter((hit) => hit.source === "arjum").length).toBe(3);
  });

  it("foreign-flow stops when x-ratelimit-remaining drops below the reserve, and skips a 404", async () => {
    const h = await harness();
    await h.run("universe");
    h.setNow(wib("2026-10-16", "19:00"));
    world.state.arjumRemaining = 401; // after the first call 400 (not below), after the second 399 (below 400)
    await h.run("foreign-flow");
    expect(world.hits.filter((hit) => hit.source === "arjum")).toHaveLength(2);

    world.hits.length = 0;
    world.state.arjumRemaining = 1000;
    await h.run("foreign-flow");
    // BBCA and BBRI are done; the rest is attempted, ABBA answers 404 and is skipped.
    expect(world.hits.map((hit) => hit.path.split("?")[0].split("/").pop())).toEqual(["BMRI", "TLKM", "GOTO", "AADI", "AALI", "ABBA"]);
    const filled = await h.db.select({ symbol: t.dailyPrices.symbol }).from(t.dailyPrices).where(and(eq(t.dailyPrices.date, "2026-10-16"), eq(t.dailyPrices.foreignSource, "arjum")));
    expect(filled.map((row) => row.symbol).sort()).toEqual(["AADI", "AALI", "BBCA", "BBRI", "BMRI", "GOTO", "TLKM"]);
  });

  it("foreign-flow: a 429 blocks arjum after one request and is never retried", async () => {
    const h = await harness();
    await h.run("universe");
    h.setNow(wib("2026-10-16", "19:00"));
    world.state.blocked.add("arjum");
    expect((await h.run("foreign-flow")).lastStatus).toBe("BLOCKED");
    expect(world.hits.filter((hit) => hit.source === "arjum")).toHaveLength(1);
    const [arjum] = await h.db.select().from(t.sources).where(eq(t.sources.id, "arjum"));
    expect(arjum).toMatchObject({ status: "BLOCKED", blockEvidence: { reason: "RATE_LIMITED", status: 429 } });
    await h.run("foreign-flow", "blocked");
  });

  it("intraday: whole-market and index snapshots stamped with the data time; identical polls add nothing; retention prunes", async () => {
    const h = await harness();
    h.setNow(wib("2026-10-19", "10:00"));
    await h.run("intraday");
    const snapshots = await h.db.select().from(t.intradaySnapshots);
    expect(snapshots).toHaveLength(5);
    expect(new Set(snapshots.map((row) => row.ts.toISOString()))).toEqual(new Set([wib("2026-10-19", "09:50").toISOString()]));
    expect(snapshots.find((row) => row.symbol === "BBCA")).toMatchObject({ last: 5225, open: 5825, change: -850, volume: 994464400, source: "tradingview-scanner" });
    expect(await h.db.select().from(t.indexIntraday)).toHaveLength(9);

    h.setNow(wib("2026-10-19", "10:05"));
    await h.run("intraday");
    expect(await h.db.select().from(t.intradaySnapshots)).toHaveLength(5);
    world.state.tvPriceFactor = 1.01;
    await h.run("intraday");
    expect(await h.db.select().from(t.intradaySnapshots)).toHaveLength(10);

    h.setNow(wib("2026-11-30", "02:30"));
    await h.run("intraday-retention");
    expect(await h.db.select().from(t.intradaySnapshots)).toEqual([]);
    expect(await h.db.select().from(t.indexIntraday)).toEqual([]);
  });

  it("end to end: universe → indices → EOD → backfill → foreign → intraday → /v1 responses", async () => {
    const h = await harness();
    await h.run("universe");
    await h.run("indices-eod");
    h.setNow(wib("2026-10-16", "16:45"));
    await h.run("eod-daily");
    h.setNow(wib("2026-10-16", "19:00"));
    await h.run("foreign-flow");
    await h.run("eod-backfill");

    // After the close: EOD responses.
    h.setNow(wib("2026-10-16", "21:30"));
    const market = idxBeiEnvelope(marketOverviewSchema).parse(await (await h.call("/v1/market")).json());
    expect(market.meta).toMatchObject({ source: "hakapro-engine", dataAsOf: "2026-10-16", freshness: "EOD" });
    expect(market.data.indices[0]).toMatchObject({ code: "COMPOSITE", close: 5232.855 });
    // 5 TradingView rows plus AADI/AALI from the fake arjum history (ABBA answers 404).
    expect(market.data.breadth).toMatchObject({ advancers: 0, decliners: 7, unchanged: 0 });
    expect(market.data.movers.map((row) => row.symbol)).toContain("BBCA");

    const stock = idxBeiEnvelope(stockSchema).parse(await (await h.call("/v1/stocks/BBCA?limit=1600")).json());
    expect(stock.meta).toMatchObject({ dataAsOf: "2026-10-16", freshness: "EOD" });
    expect(stock.data.quote).toMatchObject({ symbol: "BBCA", timestamp: "2026-10-16", close: 5225, previousClose: 6075, foreignBuy: 310000000, foreignSell: 420000000 });
    expect(stock.data.candles.at(-1)).toMatchObject({ time: "2026-10-16", close: 5225 });
    expect(stock.data.candles[0].time).toBe("2021-10-11");

    const securities = idxBeiEnvelope(securitySchema.array()).parse(await (await h.call("/v1/securities?q=bank")).json());
    expect(securities.data.map((row) => row.symbol)).toEqual(["BBCA", "BBRI", "BMRI"]);
    const actions = idxBeiEnvelope(actionsSchema).parse(await (await h.call("/v1/stocks/BBCA/actions")).json());
    expect(actions.data.map((row) => row.type)).toEqual(["DIVIDEND", "SPLIT"]);
    const signals = idxBeiEnvelope(signalsSchema).parse(await (await h.call("/v1/signals")).json());
    expect(signals.data.tradingDate).toBe("2026-10-16");
    expect(signals.data.foreignFlow.map((row) => row.signal)).toContain("distribute");

    // Next session, in progress: intraday is newer, served DELAYED with its timestamp.
    h.setNow(wib("2026-10-19", "10:00"));
    world.state.tvPriceFactor = 1.02;
    await h.run("intraday");
    const live = idxBeiEnvelope(stockSchema).parse(await (await h.call("/v1/stocks/BBCA")).json());
    expect(live.meta).toMatchObject({ freshness: "DELAYED", dataAsOf: "2026-10-19T09:50:00+07:00" });
    expect(live.data.quote).toMatchObject({ timestamp: "2026-10-19T09:50:00+07:00", close: 5330, previousClose: 5225 });
    const intradayMarket = idxBeiEnvelope(marketOverviewSchema).parse(await (await h.call("/v1/market")).json());
    expect(intradayMarket.meta.freshness).toBe("DELAYED");
    expect(intradayMarket.data.indices.find((row) => row.code === "LQ45")).toBeDefined();

    const health = (await (await h.call("/v1/meta/health")).json()) as { data: { sources: Array<{ id: string; status: string }>; eodSessions: Array<{ date: string; status: string }> } };
    expect(Object.fromEntries(health.data.sources.map((row) => [row.id, row.status]))).toEqual({ arjum: "OK", pasardana: "OK", "tradingview-scanner": "OK", "yahoo-chart": "OK" });
    expect(health.data.eodSessions[0]).toMatchObject({ date: "2026-10-16", status: "PARTIAL" });
  });
});
