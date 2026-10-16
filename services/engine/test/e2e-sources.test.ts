// E2/E2b/E3 jobs and the /v1 routes against a throwaway PostgreSQL (Docker) and the local source fixtures.
// Opt-in (`bun run engine:test:e2e`); skipped in `bun run test` and CI. No request leaves the machine: the fixture
// world refuses any URL it does not serve, and arjum is a fake.
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  actionsCalendarSchema, actionsSchema, announcementItemSchema, fundamentalsSchema, idxBeiEnvelope, macroSchema, marketOverviewSchema, newsItemSchema,
  screenResultSchema, securitySchema, signalsSchema, stockSchema,
} from "@/server/schemas/idx-bei";
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

// These tests run several jobs against a real database; give the whole suite the longer budget the slow ones already use.
describe.skipIf(!enabled)("engine sources (docker postgres + fixtures)", { timeout: 30_000 }, () => {
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
    world.state.newsUpdate = false;
    world.state.fundamentalsRateLimited = false;
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

  it("registers the E2/E2b/E3 sources and jobs with their schedules", async () => {
    const h = await harness();
    expect(h.engine.registry.sources.map((source) => [source.id, source.host, source.policy])).toEqual([
      ["tradingview-scanner", "scanner.tradingview.com", { minIntervalMs: 2000, concurrency: 1 }],
      ["yahoo-chart", "query1.finance.yahoo.com", { minIntervalMs: 3000, concurrency: 1 }],
      ["pasardana", "pasardana.id", { minIntervalMs: 3000, concurrency: 1 }],
      ["arjum", "arjum.example.test", { minIntervalMs: 2000, concurrency: 1 }],
      ["news-cnbcindonesia", "www.cnbcindonesia.com", { minIntervalMs: 5000, concurrency: 1 }],
      ["news-detik", "finance.detik.com", { minIntervalMs: 5000, concurrency: 1 }],
      ["news-antara", "www.antaranews.com", { minIntervalMs: 5000, concurrency: 1 }],
      ["news-investortrust", "investortrust.id", { minIntervalMs: 5000, concurrency: 1 }],
      ["bank-indonesia", "www.bi.go.id", { minIntervalMs: 5000, concurrency: 1 }],
      ["yahoo-fundamentals", "query1.finance.yahoo.com", { minIntervalMs: 3000, concurrency: 1 }],
    ]);
    expect(Object.fromEntries(h.engine.scheduler.status().map((job) => [job.id, job.trigger]))).toEqual({
      universe: { kind: "cron", spec: "35 16 * * *", tradingDaysOnly: true },
      "indices-eod": { kind: "cron", spec: "35 16 * * *", tradingDaysOnly: true },
      "eod-daily": { kind: "cron", spec: "45 16,18,20 * * *", tradingDaysOnly: true },
      "eod-backfill": { kind: "cron", spec: "*/10 19-23,0-5 * * *" },
      "foreign-flow": { kind: "cron", spec: "0 19,21 * * *", tradingDaysOnly: true },
      intraday: { kind: "session", everyMinutes: 5 },
      "intraday-retention": { kind: "cron", spec: "30 2 * * *" },
      news: { kind: "window", everyMinutes: 15, from: "06:00", to: "22:00" },
      "news-retention": { kind: "cron", spec: "45 2 * * *" },
      "macro-jisdor": { kind: "cron", spec: "0 17 * * *" },
      "macro-bi-rate": { kind: "cron", spec: "5 17 * * *" },
      fundamentals: { kind: "cron", spec: "5-55/10 19-23,0-5 * * *" },
      ratios: { kind: "cron", spec: "15 6,17,21 * * *" },
    });
    expect(h.engine.scheduler.status().find((job) => job.id === "fundamentals")).toMatchObject({ background: true, sourceId: "yahoo-fundamentals" });
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

  it("news: five feeds with the honest UA and 5 s per host; headline/link/time/outlet/summary with provenance", async () => {
    const h = await harness();
    await h.run("universe");
    world.hits.length = 0;
    h.setNow(wib("2026-10-16", "14:30"));
    expect((await h.run("news")).lastStatus).toBe("SUCCEEDED");
    expect(world.hits.map((hit) => `${hit.source} ${hit.path}`)).toEqual([
      "cnbc /market/rss", "detik /rss", "antara /rss/ekonomi-bursa.xml", "investortrust /rss/market.rss", "investortrust /rss/macro.rss",
    ]);
    expect(world.hits.every((hit) => hit.userAgent === ENGINE_USER_AGENT && hit.method === "GET")).toBe(true);
    // The two InvestorTrust feeds share a host: the second waits out the 5 s spacing.
    expect(h.clock.sleeps.some((ms) => ms >= 4900)).toBe(true);

    const items = await h.db.select().from(t.newsItems).orderBy(asc(t.newsItems.publishedAt));
    expect(items).toHaveLength(15);
    expect(new Set(items.map((row) => row.outlet))).toEqual(new Set(["CNBC Indonesia", "detikFinance", "ANTARA", "Investortrust"]));
    expect(items.every((row) => row.rawRef && row.asOf && row.source.startsWith("news-") && !row.publishedAtEstimated)).toBe(true);
    expect(items.every((row) => row.summary === null || (row.summary.length <= 280 && !/[<>]/.test(row.summary)))).toBe(true);
    expect(items.at(-1)).toMatchObject({
      title: "Review MSCI Bikin IHSG Anjlok Hingga 11%, Dasco Ungkap Langkah OJK-BEI", outlet: "CNBC Indonesia", source: "news-cnbcindonesia",
      url: "https://www.cnbcindonesia.com/market/20261016141345-17-776891/review-msci-bikin-ihsg-anjlok-hingga-11-dasco-ungkap-langkah-ojk-bei",
      publishedAt: new Date("2026-10-16T07:16:31Z"), symbols: [],
    });
    const docs = await h.db.select().from(t.rawDocuments).where(eq(t.rawDocuments.parseStatus, "PARSED"));
    expect(docs.filter((doc) => doc.source.startsWith("news-"))).toHaveLength(5);

    // Next poll: CNBC answers 304 to If-None-Match, Antara to If-Modified-Since, the rest are byte-identical.
    world.hits.length = 0;
    h.setNow(wib("2026-10-16", "14:45"));
    await h.run("news");
    expect(world.hits.find((hit) => hit.source === "cnbc")!.ifNoneMatch).toMatch(/^"/);
    expect(world.hits.find((hit) => hit.source === "antara")!.ifModifiedSince).toBe("Fri, 16 Oct 2026 07:27:02 GMT");
    expect(await h.db.select().from(t.newsItems)).toHaveLength(15);
    expect((await h.db.select().from(t.rawDocuments)).filter((doc) => doc.source.startsWith("news-"))).toHaveLength(5);

    // CNBC updates: a new story naming $BBCA (a known symbol) and a re-post of Antara's headline (deduped by title).
    world.state.newsUpdate = true;
    h.setNow(wib("2026-10-16", "15:00"));
    await h.run("news");
    const after = await h.db.select().from(t.newsItems);
    expect(after).toHaveLength(16);
    expect(after.find((row) => row.title === "Asing Borong $BBCA Saat IHSG Ambruk")).toMatchObject({
      url: "https://www.cnbcindonesia.com/market/20261016150000-17-776900/asing-borong-bbca", symbols: ["BBCA"], summary: "Investor asing mencatat beli bersih di BBCA.",
    });
    expect(after.filter((row) => row.titleKey === "bei minta investor tetap rasional dan lihat fundamental bursa ri").map((row) => row.outlet)).toEqual(["ANTARA"]);

    const news = idxBeiEnvelope(newsItemSchema.array()).parse(await (await h.call("/v1/news?page=1&page_size=2")).json());
    expect(news.meta).toMatchObject({ freshness: "DELAYED", dataAsOf: "2026-10-16T14:20:00+07:00" });
    expect(news.data.map((row) => row.title)).toEqual(["Asing Borong $BBCA Saat IHSG Ambruk", "Review MSCI Bikin IHSG Anjlok Hingga 11%, Dasco Ungkap Langkah OJK-BEI"]);
    const bbca = idxBeiEnvelope(newsItemSchema.array()).parse(await (await h.call("/v1/news?symbol=BBCA")).json());
    expect(bbca.data.map((row) => row.symbols)).toEqual([["BBCA"]]);
  });

  it("news: a blocked outlet stops alone with evidence and is never retried; all blocked → BLOCKED", async () => {
    const h = await harness();
    world.state.blocked.add("cnbc");
    h.setNow(wib("2026-10-16", "14:30"));
    expect((await h.run("news")).lastStatus).toBe("SUCCEEDED");
    const [cnbc] = await h.db.select().from(t.sources).where(eq(t.sources.id, "news-cnbcindonesia"));
    expect(cnbc).toMatchObject({ status: "BLOCKED", blockEvidence: { reason: "CLOUDFLARE_CHALLENGE", status: 403, headers: { "cf-mitigated": "challenge" } } });
    expect(await h.db.select().from(t.newsItems)).toHaveLength(12);

    world.hits.length = 0;
    await h.run("news");
    expect(world.hits.some((hit) => hit.source === "cnbc")).toBe(false);

    for (const source of ["detik", "antara", "investortrust"] as const) world.state.blocked.add(source);
    const fresh = await harness();
    world.hits.length = 0;
    expect((await fresh.run("news")).lastStatus).toBe("BLOCKED");
    // One request per host, then each source stops (InvestorTrust's second feed is not requested).
    expect(world.hits.map((hit) => hit.source)).toEqual(["cnbc", "detik", "antara", "investortrust"]);
  });

  it("news retention: items past ENGINE_NEWS_RETENTION_DAYS are pruned, and never stored when already too old", async () => {
    const h = await harness({ ENGINE_NEWS_RETENTION_DAYS: "30" });
    h.setNow(wib("2026-10-16", "14:30"));
    await h.run("news");
    expect(await h.db.select().from(t.newsItems)).toHaveLength(15);
    // 30 days after the 15th's items: those go, the 16th's stay.
    h.setNow(wib("2026-11-15", "02:45"));
    expect((await h.run("news-retention")).lastStatus).toBe("SUCCEEDED");
    const kept = await h.db.select().from(t.newsItems);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(15);
    expect(kept.every((row) => row.publishedAt >= new Date("2026-10-15T19:45:00Z"))).toBe(true);
    h.setNow(wib("2026-12-31", "02:45"));
    await h.run("news-retention");
    expect(await h.db.select().from(t.newsItems)).toEqual([]);

    const late = await harness({ ENGINE_NEWS_RETENTION_DAYS: "30" });
    late.setNow(wib("2026-12-31", "10:00"));
    expect((await late.run("news")).lastStatus).toBe("SUCCEEDED");
    expect(await late.db.select().from(t.newsItems)).toEqual([]);
  });

  it("macro: BI JISDOR and BI-Rate tables → macro_observations with provenance and /v1/macro; a block stops BI", async () => {
    const h = await harness();
    h.setNow(wib("2026-10-16", "17:00"));
    expect((await h.run("macro-jisdor")).lastStatus).toBe("SUCCEEDED");
    expect((await h.run("macro-bi-rate")).lastStatus).toBe("SUCCEEDED");
    const rows = await h.db.select().from(t.macroObservations).orderBy(asc(t.macroObservations.series), asc(t.macroObservations.date));
    expect(rows.map((row) => [row.series, row.date, row.value])).toEqual([
      ["BI_RATE", "2026-07-22", 5.75], ["BI_RATE", "2026-08-19", 5.75], ["BI_RATE", "2026-09-23", 5.75],
      ["JISDOR", "2026-10-13", 17930], ["JISDOR", "2026-10-14", 17898], ["JISDOR", "2026-10-15", 17948],
    ]);
    expect(rows.every((row) => row.source === "bank-indonesia" && row.rawRef && row.asOf)).toBe(true);
    expect(world.hits.map((hit) => `${hit.source} ${hit.path}`)).toEqual(["bi /id/statistik/informasi-kurs/jisdor/default.aspx", "bi /id/statistik/indikator/bi-rate.aspx"]);
    expect(world.hits.every((hit) => hit.userAgent === ENGINE_USER_AGENT)).toBe(true);
    expect(h.clock.sleeps.some((ms) => ms >= 4900)).toBe(true);

    h.setNow(wib("2026-10-16", "12:00"));
    const macro = idxBeiEnvelope(macroSchema).parse(await (await h.call("/v1/macro")).json());
    expect(macro.meta).toMatchObject({ dataAsOf: "2026-10-15", freshness: "EOD" });
    expect(macro.data.series.find((row) => row.id === "JISDOR")).toMatchObject({ value: 17948, previousValue: 17898, observations: [{ date: "2026-10-15" }, { date: "2026-10-14" }, { date: "2026-10-13" }] });
    expect(macro.data.series.find((row) => row.id === "BI_RATE")).toMatchObject({ value: 5.75, link: "https://www.bi.go.id/id/publikasi/ruang-media/news-release/Pages/sp_2819326.aspx" });

    world.state.blocked.add("bi");
    world.hits.length = 0;
    expect((await h.run("macro-jisdor")).lastStatus).toBe("BLOCKED");
    await h.run("macro-bi-rate", "blocked");
    expect(world.hits).toHaveLength(1);
    const [bi] = await h.db.select().from(t.sources).where(eq(t.sources.id, "bank-indonesia"));
    expect(bi).toMatchObject({ status: "BLOCKED", blockEvidence: { reason: "CDN_FORBIDDEN" } });
  });

  it("fundamentals: one Yahoo call per symbol, most liquid first, spaced with the chart on one host; weekly cycle + catch-up", async () => {
    const h = await harness();
    await h.run("universe");
    world.hits.length = 0;
    h.clock.sleeps.length = 0;
    h.setNow(wib("2026-10-16", "20:05")); // Friday, inside the October filing window
    expect((await h.run("fundamentals")).lastStatus).toBe("SUCCEEDED");
    const calls = world.hits.filter((hit) => hit.source === "yahoo");
    const tickers = (hits: typeof calls) => hits.map((hit) => decodeURIComponent(hit.path.split("?")[0].split("/").pop()!));
    expect(tickers(calls)).toEqual(["BBCA.JK", "BBRI.JK", "BMRI.JK", "TLKM.JK", "GOTO.JK", "AADI.JK", "AALI.JK", "ABBA.JK"]);
    expect(calls.every((hit) => hit.userAgent === ENGINE_USER_AGENT && hit.method === "GET")).toBe(true);
    expect(calls[0].path).toContain(`period2=${Date.parse("2026-10-17T00:00:00+07:00") / 1000}`);
    expect(h.clock.sleeps.filter((ms) => ms > 2000).length).toBeGreaterThanOrEqual(7); // 3 s apart on the Yahoo host

    const rows = await h.db.select().from(t.financials);
    const count = (symbol: string) => rows.filter((row) => row.symbol === symbol).length;
    expect([count("BBCA"), count("TLKM"), count("GOTO")]).toEqual([101, 120, 69]);
    expect(new Set(rows.map((row) => row.symbol))).toEqual(new Set(["BBCA", "TLKM", "GOTO"])); // the others answered 404
    expect(rows.every((row) => row.source === "yahoo-fundamentals" && row.rawRef && row.asOf)).toBe(true);
    expect(rows.find((row) => row.symbol === "BBCA" && row.metric === "netIncome" && row.periodType === "quarterly" && row.periodEnd === "2026-06-30"))
      .toMatchObject({ value: 14850323000000, unit: "amount", currency: "IDR" });
    const docs = await h.db.select().from(t.rawDocuments).where(eq(t.rawDocuments.source, "yahoo-fundamentals"));
    expect(docs).toHaveLength(3);
    expect(docs.every((doc) => doc.parseStatus === "PARSED" && doc.url.startsWith("https://query1.finance.yahoo.com/ws/fundamentals-timeseries/"))).toBe(true);
    let [cursor] = await h.db.select().from(t.jobCursors).where(eq(t.jobCursors.jobId, "fundamentals"));
    expect(cursor.cursor).toMatchObject({ full: { key: "2026-10-12" }, expectedQuarter: "2026-06-30" });

    // Same week, full pass done: the catch-up refetches only symbols without the expected quarter (2026-06-30).
    world.hits.length = 0;
    await h.run("fundamentals");
    expect(tickers(world.hits)).toEqual(["BBRI.JK", "BMRI.JK", "AADI.JK", "AALI.JK", "ABBA.JK"]);
    world.hits.length = 0;
    await h.run("fundamentals");
    expect(world.hits).toEqual([]);
    // Next Monday: a new weekly cycle; restated values replace stored ones instead of adding rows.
    h.setNow(wib("2026-10-19", "20:05"));
    await h.run("fundamentals");
    expect(world.hits).toHaveLength(8);
    [cursor] = await h.db.select().from(t.jobCursors).where(eq(t.jobCursors.jobId, "fundamentals"));
    expect(cursor.cursor).toMatchObject({ full: { key: "2026-10-19" }, catchup: null });
    expect((await h.db.select().from(t.financials)).length).toBe(290);
  }, 30_000);

  it("fundamentals: a 429 stops both Yahoo sources after one request; the job refuses while the chart is blocked", async () => {
    const h = await harness();
    await h.run("universe");
    world.hits.length = 0;
    world.state.fundamentalsRateLimited = true;
    h.setNow(wib("2026-10-16", "20:05"));
    expect((await h.run("fundamentals")).lastStatus).toBe("BLOCKED");
    expect(world.hits).toHaveLength(1);
    const blocked = await h.db.select().from(t.sources).where(eq(t.sources.host, "query1.finance.yahoo.com")).orderBy(asc(t.sources.id));
    expect(blocked.map((row) => [row.id, row.status, row.blockEvidence?.reason])).toEqual([["yahoo-chart", "BLOCKED", "RATE_LIMITED"], ["yahoo-fundamentals", "BLOCKED", "RATE_LIMITED"]]);
    // The chart jobs stop too: the backfill refuses to start, eod-daily skips the blocked source.
    await h.run("eod-backfill", "blocked");
    await h.run("eod-daily");
    expect(world.hits).toHaveLength(1);
    await h.run("fundamentals", "blocked");
    // Unblocking only the fundamentals source is not enough: the shared host's chart source is still blocked.
    await h.engine.services.sourceState.unblock("yahoo-fundamentals");
    world.state.fundamentalsRateLimited = false;
    expect((await h.run("fundamentals")).lastStatus).toBe("BLOCKED");
    expect(world.hits).toHaveLength(1);
  }, 30_000);

  it("ratios + /v1 fundamentals + screener: derived from statements and the close, Pasardana as the secondary source", async () => {
    const h = await harness();
    await h.run("universe");
    h.setNow(wib("2026-10-16", "16:45"));
    await h.run("eod-daily");
    h.setNow(wib("2026-10-16", "19:10"));
    await h.run("eod-backfill");
    h.setNow(wib("2026-10-16", "20:05"));
    await h.run("fundamentals");
    world.hits.length = 0;
    h.setNow(wib("2026-10-16", "21:15"));
    expect((await h.run("ratios")).lastStatus).toBe("SUCCEEDED");
    expect(world.hits).toEqual([]); // no network

    const ratios = await h.db.select().from(t.stockRatios).orderBy(asc(t.stockRatios.symbol), asc(t.stockRatios.ratio), asc(t.stockRatios.ratioSource));
    const of = (symbol: string, ratio: string, source = "derived") => ratios.find((row) => row.symbol === symbol && row.ratio === ratio && row.ratioSource === source);
    // BBCA: NI ttm (ttm-ytd) 58 055 319 M / 122 841 751 300 shares; close 5 225 (Yahoo, 2026-10-16).
    const bbcaEps = 58_055_319_000_000 / 122_841_751_300;
    expect(of("BBCA", "eps")).toMatchObject({ basis: "ttm-ytd:2026-06-30", date: "2026-10-16", derivation: "ratios-v1", source: "yahoo-fundamentals" });
    expect(of("BBCA", "eps")!.value).toBeCloseTo(bbcaEps, 6);
    expect(of("BBCA", "per")!.value).toBeCloseTo(5225 / bbcaEps, 6);
    expect(of("BBCA", "roe")!.value).toBeCloseTo(58_055_319 / 270_437_543, 8);
    expect(of("BBCA", "per")!.rawRef).not.toBeNull();
    // BBCA's price history reaches back a year (backfill) and no dividend went ex in the window: a true zero.
    expect(of("BBCA", "dividendYield")).toMatchObject({ value: 0, basis: "dividends-365d", source: "yahoo-chart" });
    // TLKM: four consecutive quarters; TradingView's fallback close 1 965 (Yahoo has no chart fixture for it).
    const tlkmEps = (4_809 + 1_702 + 4_344 + 6_279) * 1e9 / 98_580_940_800;
    expect(of("TLKM", "per")).toMatchObject({ basis: "ttm-4q:2026-06-30" });
    expect(of("TLKM", "per")!.value).toBeCloseTo(1965 / tlkmEps, 6);
    // TLKM's price history is short: its dividend yield comes from the cash flow statement.
    expect(of("TLKM", "dividendYield")).toMatchObject({ basis: "annual:2025-12-31" });
    expect(of("TLKM", "dividendYield")!.value).toBeCloseTo(21_047e9 / (1965 * 98_580_940_800), 8);
    // Pasardana's own ratios are stored next to them with their provenance.
    expect(of("AADI", "per", "pasardana")).toMatchObject({ value: 6.17137, date: "2026-10-15", basis: "pasardana:Per", source: "pasardana" });
    expect(of("AADI", "per", "pasardana")!.rawRef).not.toBeNull();
    expect(of("AADI", "per")).toBeUndefined();

    const fundamentals = idxBeiEnvelope(fundamentalsSchema).parse(await (await h.call("/v1/stocks/BBCA/fundamentals")).json());
    expect(fundamentals.meta).toMatchObject({ source: "hakapro-engine", dataAsOf: "2026-06-30", freshness: "HISTORICAL" });
    expect(fundamentals.data.map((row) => `${row.periodDate} ${row.periodType}`)).toEqual([
      "2026-06-30 QUARTERLY", "2026-03-31 QUARTERLY", "2025-12-31 ANNUAL", "2025-12-31 QUARTERLY", "2025-06-30 QUARTERLY", "2025-03-31 QUARTERLY",
      "2024-12-31 ANNUAL", "2023-12-31 ANNUAL", "2022-12-31 ANNUAL",
    ]);
    expect(fundamentals.data[0]).toMatchObject({ currency: "IDR", source: "yahoo-fundamentals", metrics: { netIncome: 14850323000000, equity: 270437543000000 }, units: { netIncome: "IDR", sharesOutstanding: "shares" } });
    expect(idxBeiEnvelope(fundamentalsSchema).parse(await (await h.call("/v1/stocks/BBRI/fundamentals")).json())).toMatchObject({ data: [], meta: { freshness: "UNAVAILABLE" } });

    const post = (body: unknown) => h.engine.app(new Request("http://engine.test/v1/screener", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
    const screen = idxBeiEnvelope(screenResultSchema).parse(await (await post({ conditions: [{ field: "per", operator: "LT", value: 15 }, { field: "roe", operator: "GT", value: 0.1 }], limit: 50 })).json());
    expect(screen.meta).toMatchObject({ dataAsOf: "2026-10-16", freshness: "EOD" });
    expect(screen.data.rows.map((row) => row.symbol)).toEqual(["BBCA", "TLKM"]);
    expect(screen.data.ratioSources).toMatchObject({ BBCA: { per: "derived", roe: "derived" }, TLKM: { per: "derived" } });
    expect(screen.data.rows[0].per).toBeCloseTo(5225 / bbcaEps, 6);
    expect(screen.data.supportedFields).toEqual(expect.arrayContaining(["price", "value", "per", "pbv", "roe", "roa", "eps", "der", "dividendYield", "change1D"]));
    // GOTO's earnings are barely positive: a real PER, not a cap.
    const all = idxBeiEnvelope(screenResultSchema).parse(await (await post({ conditions: [], limit: 500 })).json());
    expect(all.data.total).toBe(5);
    expect(all.data.rows.find((row) => row.symbol === "BBRI")).toMatchObject({ per: null, pbv: null, eps: null });
    expect((await post({ conditions: [{ field: "nope", operator: "GT", value: 1 }] })).status).toBe(400);
    expect((await post({ conditions: Array.from({ length: 21 }, () => ({ field: "price", operator: "GT", value: 0 })) })).status).toBe(400);
  }, 30_000);

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
    // Market-wide calendar from the stored Yahoo events (ex-dates only).
    const calendar = idxBeiEnvelope(actionsCalendarSchema).parse(await (await h.call("/v1/actions?from=2021-10-01&to=2021-12-31")).json());
    expect(calendar.data.map((row) => [row.symbol, row.date, row.type, row.ratio, row.amount])).toEqual([["BBCA", "2021-10-13", "SPLIT", "5:1", null], ["BBCA", "2021-11-17", "DIVIDEND", null, 25]]);
    expect(idxBeiEnvelope(actionsCalendarSchema).parse(await (await h.call("/v1/actions")).json()).data).toEqual([]);
    const announcements = idxBeiEnvelope(announcementItemSchema.array()).parse(await (await h.call("/v1/announcements")).json());
    expect(announcements).toMatchObject({ data: [], meta: { freshness: "UNAVAILABLE" } });

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

    const health = (await (await h.call("/v1/meta/health")).json()) as {
      data: { sources: Array<{ id: string; status: string }>; eodSessions: Array<{ date: string; status: string }>; unavailable: Array<{ route: string; status: string }> };
    };
    expect(Object.fromEntries(health.data.sources.map((row) => [row.id, row.status]))).toEqual({
      arjum: "OK", pasardana: "OK", "tradingview-scanner": "OK", "yahoo-chart": "OK",
      "bank-indonesia": "NEVER_RUN", "news-antara": "NEVER_RUN", "news-cnbcindonesia": "NEVER_RUN", "news-detik": "NEVER_RUN", "news-investortrust": "NEVER_RUN",
      "yahoo-fundamentals": "NEVER_RUN",
    });
    expect(health.data.unavailable.map((row) => row.route)).toEqual(["/v1/announcements", "/v1/stocks/{s}/profile", "/v1/strategies"]);
    expect(health.data.unavailable.find((row) => row.route === "/v1/strategies")?.status).toBe("DISABLED");
    expect(health.data.unavailable.find((row) => row.route === "/v1/announcements")?.status).toBe("SOURCE_BLOCKED");
    expect(health.data.eodSessions[0]).toMatchObject({ date: "2026-10-16", status: "PARTIAL" });
  });
});
