import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  actionsCalendarSchema, actionsSchema, announcementItemSchema, fundamentalsSchema, idxBeiEnvelope, macroSchema, marketOverviewSchema, newsItemSchema,
  screenResultSchema, securitySchema, signalsSchema, stockSchema,
} from "@/server/schemas/idx-bei";
import { tempDir } from "../../test/support";
import { MemoryCursorStore, MemoryRunRecorder, MemorySourceStateStore } from "../fetch/stores";
import { MemoryMarketStore, type NewsRecord } from "../serve/store";
import { PauseGuard } from "../schedule/pause";
import { Scheduler } from "../schedule/scheduler";
import { createApp, type AppDeps } from "./app";
import { intradayMeta } from "./envelope";

const BASE = "http://engine.test";

describe("engine HTTP app", () => {
  let dir: Awaited<ReturnType<typeof tempDir>>;
  let dbUp = true;
  let disk = 40;
  let jobRuns = 0;

  beforeEach(async () => { dir = await tempDir(); dbUp = true; disk = 40; jobRuns = 0; });
  afterEach(async () => { await dir.cleanup(); });

  function app(overrides: Partial<AppDeps> = {}) {
    const pause = new PauseGuard(dir.path, 85, { cacheMs: 0, measure: async () => disk });
    const sourceState = new MemorySourceStateStore();
    const scheduler = new Scheduler({
      jobs: [{ id: "demo-job", trigger: { kind: "cron", spec: "0 0 1 1 *" }, run: async () => { jobRuns += 1; } }],
      pause, runs: new MemoryRunRecorder(), cursors: new MemoryCursorStore(), sourceState,
    });
    const handler = createApp({
      ping: async () => dbUp, pause, scheduler, rawStoreKind: "local",
      sourceHealth: async () => [{ id: "fixture", host: "127.0.0.1", status: "BLOCKED", blocked: true, blockedAt: "2026-10-14T09:00:00.000Z", blockReason: "CLOUDFLARE_CHALLENGE", lastSuccessAt: null, lastErrorAt: null, lastError: null, rowsIngested: 0 }],
      unblockSource: async () => true,
      now: () => new Date("2026-10-14T10:00:00Z"),
      ...overrides,
    });
    return { handler, scheduler, call: (path: string, init?: RequestInit) => handler(new Request(`${BASE}${path}`, init)) };
  }

  it("serves liveness and readiness", async () => {
    const { call } = app();
    expect((await call("/health")).status).toBe(200);
    expect((await call("/ready")).status).toBe(200);
    dbUp = false;
    const down = await call("/ready");
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ status: "not_ready", checks: { database: false } });
    dbUp = true;
    disk = 90;
    expect((await call("/ready")).status).toBe(503);
  });

  it("returns contract-valid empty envelopes for the /v1 stubs", async () => {
    const { call } = app();
    const cases: Array<[string, Parameters<typeof idxBeiEnvelope>[0]]> = [
      ["/v1/market", marketOverviewSchema],
      ["/v1/securities?q=bb", securitySchema.array()],
      ["/v1/news?page=1&page_size=20", newsItemSchema.array()],
      ["/v1/announcements?page=1&page_size=20", announcementItemSchema.array()],
      ["/v1/stocks/BBCA/fundamentals", fundamentalsSchema],
      ["/v1/stocks/BBCA/actions", actionsSchema],
      ["/v1/macro", macroSchema],
      ["/v1/actions", actionsCalendarSchema],
    ];
    for (const [path, schema] of cases) {
      const response = await call(path);
      expect(response.status, path).toBe(200);
      const body = idxBeiEnvelope(schema).parse(await response.json());
      expect(body.meta).toEqual({ source: "hakapro-engine", fetchedAt: "2026-10-14T10:00:00.000Z", dataAsOf: null, freshness: "UNAVAILABLE" });
    }
    const screen = await call("/v1/screener", { method: "POST", body: JSON.stringify({ conditions: [], limit: 10 }), headers: { "content-type": "application/json" } });
    expect(idxBeiEnvelope(screenResultSchema).parse(await screen.json()).data.rows).toEqual([]);
    expect((await call("/v1/screener", { method: "POST", body: "{bad" })).status).toBe(400);
    expect((await call("/v1/stocks/BBCA")).status).toBe(404);
    expect((await call("/v1/stocks/BBCA/profile")).status).toBe(404);
    expect((await call("/v1/stocks/bad$sym")).status).toBe(400);
    expect((await call("/v1/unknown")).status).toBe(404);
  });

  it("requires the API bearer token on /v1/* when configured, never on /health", async () => {
    const { call } = app({ apiToken: "api-secret-for-tests" });
    expect((await call("/health")).status).toBe(200);
    expect((await call("/v1/market")).status).toBe(401);
    expect((await call("/v1/market", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await call("/v1/market", { headers: { authorization: "Bearer api-secret-for-tests" } })).status).toBe(200);
  });

  it("reports per-source health and scheduler state", async () => {
    const { call } = app();
    const body = (await (await call("/v1/meta/health")).json()) as { data: { sources: unknown[]; scheduler: unknown }; meta: { freshness: string } };
    expect(body.data.sources[0]).toMatchObject({ id: "fixture", blocked: true, blockReason: "CLOUDFLARE_CHALLENGE", rowsIngested: 0 });
    expect(body.data.scheduler).toMatchObject({ paused: false, diskStopPercent: 85, jobs: [{ id: "demo-job", running: false }] });
    expect(body.meta.freshness).toBe("UNAVAILABLE");
    // Announcements stay empty on purpose; health says why.
    const unavailable = (body.data as unknown as { unavailable: Array<{ route: string; status: string; reason: string }> }).unavailable;
    expect(unavailable.find((row) => row.route === "/v1/announcements")).toMatchObject({ status: "SOURCE_BLOCKED", reason: expect.stringContaining("Cloudflare HTTP 403") });
  });

  it("restores last job outcomes from persisted run history after a restart", async () => {
    const { call } = app({ jobHistory: async () => [{
      id: "demo-job", lastStartedAt: "2026-10-16T09:00:00.000Z", lastStatus: "SUCCEEDED", lastError: null,
    }] });
    const response = await call("/v1/meta/health");
    const body = await response.json() as { data: { scheduler: { jobs: Array<Record<string, unknown>> } } };
    expect(body.data.scheduler.jobs).toContainEqual(expect.objectContaining({
      id: "demo-job", lastStartedAt: "2026-10-16T09:00:00.000Z", lastStatus: "SUCCEEDED", lastError: null,
    }));
  });

  it("admin endpoints are disabled without ENGINE_ADMIN_TOKEN and token-gated with it", async () => {
    expect((await app().call("/v1/admin/jobs/demo-job/run", { method: "POST" })).status).toBe(404);
    const { call, scheduler } = app({ adminToken: "admin-secret-for-tests", apiToken: "api-secret-for-tests" });
    const auth = { authorization: "Bearer admin-secret-for-tests" };
    expect((await call("/v1/admin/jobs/demo-job/run", { method: "POST", headers: { authorization: "Bearer api-secret-for-tests" } })).status).toBe(401);
    const run = await call("/v1/admin/jobs/demo-job/run", { method: "POST", headers: auth });
    expect(run.status).toBe(202);
    await scheduler.waitFor("demo-job");
    expect(jobRuns).toBe(1);
    expect((await call("/v1/admin/jobs/missing/run", { method: "POST", headers: auth })).status).toBe(404);
    expect((await call("/v1/admin/jobs/demo-job/run", { headers: auth })).status).toBe(405);

    expect(await (await call("/v1/admin/pause", { method: "POST", headers: auth })).json()).toMatchObject({ data: { paused: true, reason: "flag" } });
    expect(await (await call("/v1/admin/jobs/demo-job/run", { method: "POST", headers: auth })).json()).toEqual({ data: { status: "paused", reason: "flag" } });
    expect(await (await call("/v1/admin/resume", { method: "POST", headers: auth })).json()).toMatchObject({ data: { paused: false } });
    expect((await call("/v1/admin/sources/fixture/unblock", { method: "POST", headers: auth })).status).toBe(200);
  });
});

describe("engine HTTP app with stored data", () => {
  let dir: Awaited<ReturnType<typeof tempDir>>;
  beforeEach(async () => { dir = await tempDir(); });
  afterEach(async () => { await dir.cleanup(); });

  const asOf = new Date("2026-10-16T09:35:00Z");
  const market = new MemoryMarketStore({
    securities: [{ symbol: "BBCA", name: "PT Bank Central Asia Tbk", sector: "Finance", subsector: null, board: null, sharesOutstanding: 123_000_000_000, freeFloatPct: 40, asOf }],
    daily: [
      { symbol: "BBCA", date: "2026-10-15", open: 6075, high: 6125, low: 6025, close: 6075, previousClose: 6125, volume: 1, value: 2e12, frequency: 3, foreignBuy: 70, foreignSell: 90 },
      { symbol: "BBCA", date: "2026-10-16", open: 5825, high: 5825, low: 5175, close: 5225, previousClose: 6075, volume: 1, value: 5e12, frequency: 3, foreignBuy: 310, foreignSell: 420 },
    ],
    indexDaily: [{ code: "COMPOSITE", name: "IDX Composite Index", date: "2026-10-16", close: 5227, previousClose: 5863.78, changePercent: -0.1086 }],
    actions: [{ symbol: "BBCA", exDate: "2021-10-13", type: "SPLIT", description: "Stock split 5:1", asOf }],
  });

  function call(path: string) {
    const pause = new PauseGuard(dir.path, 85, { cacheMs: 0, measure: async () => 10 });
    const scheduler = new Scheduler({ jobs: [], pause, runs: new MemoryRunRecorder(), cursors: new MemoryCursorStore(), sourceState: new MemorySourceStateStore() });
    const handler = createApp({
      ping: async () => true, pause, scheduler, rawStoreKind: "local", sourceHealth: async () => [], unblockSource: async () => false, market,
      eodSessions: async () => [{ date: "2026-10-16", status: "PARTIAL", expected: 900, present: 880, attempts: 1, finalizedAt: null }],
      now: () => new Date("2026-10-16T10:00:00Z"),
    });
    return handler(new Request(`${BASE}${path}`));
  }

  it("serves every data route through the shared schemas with EOD freshness", async () => {
    const cases: Array<[string, Parameters<typeof idxBeiEnvelope>[0]]> = [
      ["/v1/market", marketOverviewSchema], ["/v1/securities?q=bb", securitySchema.array()], ["/v1/stocks/BBCA?limit=1", stockSchema],
      ["/v1/stocks/bbca/actions", actionsSchema], ["/v1/signals", signalsSchema],
    ];
    for (const [path, schema] of cases) {
      const response = await call(path);
      expect(response.status, path).toBe(200);
      const body = idxBeiEnvelope(schema).parse(await response.json());
      expect(body.meta, path).toMatchObject({ source: "hakapro-engine", freshness: "EOD", dataAsOf: "2026-10-16" });
    }
    const stock = stockSchema.parse(((await (await call("/v1/stocks/BBCA?limit=1")).json()) as { data: unknown }).data);
    expect(stock.candles).toHaveLength(1);
    expect(stock.quote).toMatchObject({ close: 5225, foreignBuy: 310 });
    const signals = signalsSchema.parse(((await (await call("/v1/signals")).json()) as { data: unknown }).data);
    expect(signals.foreignFlow[0]).toMatchObject({ symbol: "BBCA", signal: "distribute", sessions: 2 });
  });

  it("keeps typed misses: unknown symbol, bad limit, profile, empty search", async () => {
    expect((await call("/v1/stocks/ZZZZ")).status).toBe(404);
    expect((await call("/v1/stocks/BBCA?limit=0")).status).toBe(400);
    expect((await call("/v1/stocks/BBCA/profile")).status).toBe(404);
    const empty = idxBeiEnvelope(securitySchema.array()).parse(await (await call("/v1/securities?q=zzz")).json());
    expect(empty).toMatchObject({ data: [], meta: { freshness: "UNAVAILABLE" } });
    const actions = idxBeiEnvelope(actionsSchema).parse(await (await call("/v1/stocks/TLKM/actions")).json());
    expect(actions.data).toEqual([]);
  });

  it("reports EOD session completeness in /v1/meta/health", async () => {
    const body = (await (await call("/v1/meta/health")).json()) as { data: { eodSessions: unknown[] } };
    expect(body.data.eodSessions).toEqual([{ date: "2026-10-16", status: "PARTIAL", expected: 900, present: 880, attempts: 1, finalizedAt: null }]);
  });
});

describe("engine HTTP app: E3 market info", () => {
  let dir: Awaited<ReturnType<typeof tempDir>>;
  beforeEach(async () => { dir = await tempDir(); });
  afterEach(async () => { await dir.cleanup(); });

  const asOf = new Date("2026-10-16T10:00:00Z");
  const headline = (minutesAgo: number, title: string, symbols: string[] = [], extra: Partial<NewsRecord> = {}): NewsRecord => ({
    publishedAt: new Date(asOf.getTime() - minutesAgo * 60_000), publishedAtEstimated: false, title, url: `https://news.test/${encodeURIComponent(title)}`,
    outlet: "CNBC Indonesia", summary: null, symbols, ...extra,
  });
  const market = new MemoryMarketStore({
    news: [
      headline(90, "IHSG ditutup anjlok"), headline(30, "Asing lepas BBCA", ["BBCA"], { summary: "Ringkasan feed." }),
      headline(60, "BBCA dan BBRI tertekan", ["BBCA", "BBRI"], { outlet: "ANTARA", publishedAtEstimated: true }),
    ],
    macro: [
      { series: "JISDOR", date: "2026-10-15", value: 17948, link: null }, { series: "JISDOR", date: "2026-10-14", value: 17898, link: null },
      { series: "BI_RATE", date: "2026-09-23", value: 5.75, link: "https://www.bi.go.id/sp.aspx" }, { series: "BI_RATE", date: "2026-08-19", value: 5.5, link: null },
    ],
    actions: [
      { symbol: "BBCA", exDate: "2026-10-01", type: "DIVIDEND", description: "Cash dividend IDR 50 per share", amount: 50, asOf },
      { symbol: "AALI", exDate: "2026-10-01", type: "DIVIDEND", description: "Cash dividend IDR 100 per share", amount: 100, asOf },
      { symbol: "BBRI", exDate: "2026-09-01", type: "SPLIT", description: "Stock split 2:1", ratio: "2:1", asOf },
      { symbol: "BBCA", exDate: "2021-10-13", type: "SPLIT", description: "Stock split 5:1", ratio: "5:1", asOf },
    ],
  });

  function call(path: string, now = new Date("2026-10-16T10:00:00Z"), store: MemoryMarketStore | undefined = market) {
    const pause = new PauseGuard(dir.path, 85, { cacheMs: 0, measure: async () => 10 });
    const scheduler = new Scheduler({ jobs: [], pause, runs: new MemoryRunRecorder(), cursors: new MemoryCursorStore(), sourceState: new MemorySourceStateStore() });
    const handler = createApp({ ping: async () => true, pause, scheduler, rawStoreKind: "local", sourceHealth: async () => [], unblockSource: async () => false, market: store, now: () => now });
    return handler(new Request(`${BASE}${path}`));
  }

  it("serves /v1/news newest first with paging and a symbol filter, DELAYED while fresh, STALE after a day", async () => {
    const body = idxBeiEnvelope(newsItemSchema.array()).parse(await (await call("/v1/news?page=1&page_size=2")).json());
    expect(body.meta).toMatchObject({ freshness: "DELAYED", dataAsOf: "2026-10-16T16:30:00+07:00" });
    expect(body.data).toEqual([
      { date: "2026-10-16T16:30:00+07:00", title: "Asing lepas BBCA", summary: "Ringkasan feed.", url: "https://news.test/Asing%20lepas%20BBCA", outlet: "CNBC Indonesia", symbols: ["BBCA"], dateEstimated: false },
      { date: "2026-10-16T16:00:00+07:00", title: "BBCA dan BBRI tertekan", summary: null, url: "https://news.test/BBCA%20dan%20BBRI%20tertekan", outlet: "ANTARA", symbols: ["BBCA", "BBRI"], dateEstimated: true },
    ]);
    const page2 = idxBeiEnvelope(newsItemSchema.array()).parse(await (await call("/v1/news?page=2&page_size=2")).json());
    expect(page2.data.map((row) => row.title)).toEqual(["IHSG ditutup anjlok"]);
    const bbri = idxBeiEnvelope(newsItemSchema.array()).parse(await (await call("/v1/news?symbol=bbri")).json());
    expect(bbri.data.map((row) => row.title)).toEqual(["BBCA dan BBRI tertekan"]);
    const later = idxBeiEnvelope(newsItemSchema.array()).parse(await (await call("/v1/news", new Date("2026-10-18T10:00:00Z"))).json());
    expect(later.meta.freshness).toBe("STALE");
    expect(later.data).toHaveLength(3); // default page_size 20
    for (const bad of ["page=0", "page_size=101", "page=abc", "symbol=bad$"]) expect((await call(`/v1/news?${bad}`)).status, bad).toBe(400);
    const empty = idxBeiEnvelope(newsItemSchema.array()).parse(await (await call("/v1/news", undefined, new MemoryMarketStore())).json());
    expect(empty).toMatchObject({ data: [], meta: { freshness: "UNAVAILABLE", dataAsOf: null } });
  });

  it("serves /v1/macro with the newest observation, the previous one and the history", async () => {
    // Friday 12:00 WIB: the 15th is the last completed session, so the 15th's JISDOR is current.
    const body = idxBeiEnvelope(macroSchema).parse(await (await call("/v1/macro", new Date("2026-10-16T05:00:00Z"))).json());
    expect(body.meta).toMatchObject({ dataAsOf: "2026-10-15", freshness: "EOD" });
    // After the close without the 16th's row it is a day behind.
    expect(idxBeiEnvelope(macroSchema).parse(await (await call("/v1/macro")).json()).meta.freshness).toBe("STALE");
    expect(body.data.series).toEqual([
      { id: "BI_RATE", name: "BI-Rate", unit: "percent", date: "2026-09-23", value: 5.75, previousDate: "2026-08-19", previousValue: 5.5, link: "https://www.bi.go.id/sp.aspx", observations: [{ date: "2026-09-23", value: 5.75 }, { date: "2026-08-19", value: 5.5 }] },
      { id: "JISDOR", name: "JISDOR USD/IDR", unit: "IDR per USD", date: "2026-10-15", value: 17948, previousDate: "2026-10-14", previousValue: 17898, link: null, observations: [{ date: "2026-10-15", value: 17948 }, { date: "2026-10-14", value: 17898 }] },
    ]);
    const empty = idxBeiEnvelope(macroSchema).parse(await (await call("/v1/macro", undefined, new MemoryMarketStore())).json());
    expect(empty).toMatchObject({ data: { series: [] }, meta: { freshness: "UNAVAILABLE" } });
  });

  it("serves the /v1/actions calendar oldest first within from/to (default: 30 days back, 60 ahead)", async () => {
    const body = idxBeiEnvelope(actionsCalendarSchema).parse(await (await call("/v1/actions")).json());
    expect(body.meta).toMatchObject({ dataAsOf: "2026-10-16" });
    expect(body.data).toEqual([
      { symbol: "AALI", date: "2026-10-01", type: "DIVIDEND", description: "Cash dividend IDR 100 per share", amount: 100, ratio: null, documentUrl: null },
      { symbol: "BBCA", date: "2026-10-01", type: "DIVIDEND", description: "Cash dividend IDR 50 per share", amount: 50, ratio: null, documentUrl: null },
    ]);
    const wide = idxBeiEnvelope(actionsCalendarSchema).parse(await (await call("/v1/actions?from=2026-01-01&to=2026-12-31")).json());
    expect(wide.data.map((row) => `${row.symbol} ${row.type} ${row.ratio}`)).toEqual(["BBRI SPLIT 2:1", "AALI DIVIDEND null", "BBCA DIVIDEND null"]);
    for (const bad of ["from=2026-13-01", "from=2026-02-30", "to=yesterday", "from=2026-10-10&to=2026-10-01", "from=2024-01-01&to=2026-01-01"]) {
      expect((await call(`/v1/actions?${bad}`)).status, bad).toBe(400);
    }
  });

  it("keeps /v1/announcements the empty UNAVAILABLE form even with stored data", async () => {
    const body = idxBeiEnvelope(announcementItemSchema.array()).parse(await (await call("/v1/announcements?page=1&page_size=20&keywords=dividen")).json());
    expect(body).toMatchObject({ data: [], meta: { freshness: "UNAVAILABLE", dataAsOf: null } });
  });
});

describe("intradayMeta", () => {
  it("labels intraday snapshots DELAYED with their timestamp, never LIVE", () => {
    const meta = intradayMeta(new Date("2026-10-14T03:05:00Z"), new Date("2026-10-14T03:06:00Z"));
    expect(meta).toMatchObject({ freshness: "DELAYED", dataAsOf: "2026-10-14T03:05:00.000Z" });
    expect(intradayMeta(null, new Date()).freshness).toBe("UNAVAILABLE");
  });
});
