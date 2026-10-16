import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  actionsSchema, announcementItemSchema, fundamentalsSchema, idxBeiEnvelope, marketOverviewSchema, newsItemSchema,
  screenResultSchema, securitySchema,
} from "@/server/schemas/idx-bei";
import { tempDir } from "../../test/support";
import { MemoryCursorStore, MemoryRunRecorder, MemorySourceStateStore } from "../fetch/stores";
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

describe("intradayMeta", () => {
  it("labels intraday snapshots DELAYED with their timestamp, never LIVE", () => {
    const meta = intradayMeta(new Date("2026-10-14T03:05:00Z"), new Date("2026-10-14T03:06:00Z"));
    expect(meta).toMatchObject({ freshness: "DELAYED", dataAsOf: "2026-10-14T03:05:00.000Z" });
    expect(intradayMeta(null, new Date()).freshness).toBe("UNAVAILABLE");
  });
});
