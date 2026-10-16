// End to end against a throwaway PostgreSQL in Docker: fixture source → fetch → raw store → parse → DB → API.
// Opt-in (`bun run engine:test:e2e`, sets ENGINE_E2E_DOCKER=1); skipped in `bun run test` and CI.
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as t from "../db/schema";
import { loadConfig } from "../src/config";
import { createEngine } from "../src/engine";
import { ENGINE_USER_AGENT } from "../src/fetch/fetcher";
import { nullLogger } from "../src/log";
import { FIXTURE_CSV, fixtureRegistry, startFixtureServer, type FixtureServer } from "./fixture-source";
import { tempDir } from "./support";

const docker = (...args: string[]) => spawnSync("docker", args, { encoding: "utf8" });
const enabled = process.env.ENGINE_E2E_DOCKER === "1" && docker("info", "--format", "{{.ServerVersion}}").status === 0;
if (process.env.ENGINE_E2E_DOCKER === "1" && !enabled) console.warn("engine e2e skipped: docker is not available");

describe.skipIf(!enabled)("engine e2e (docker postgres)", () => {
  let container = "";
  let url = "";
  let fixture: FixtureServer;
  let dir: Awaited<ReturnType<typeof tempDir>>;
  let engine: Awaited<ReturnType<typeof createEngine>>;
  const ADMIN = { authorization: "Bearer e2e-admin-token" };
  const call = (path: string, init?: RequestInit) => engine.app(new Request(`http://engine.test${path}`, init));
  const runJob = async (id: string) => {
    const response = await call(`/v1/admin/jobs/${id}/run`, { method: "POST", headers: ADMIN });
    expect(response.status).toBe(202);
    await engine.scheduler.waitFor(id);
  };

  beforeAll(async () => {
    const started = docker("run", "-d", "--rm", "-e", "POSTGRES_PASSWORD=engine", "-e", "POSTGRES_USER=engine", "-e", "POSTGRES_DB=engine", "-p", "127.0.0.1::5432", "postgres:17-alpine");
    if (started.status !== 0) throw new Error(`docker run failed: ${started.stderr}`);
    container = started.stdout.trim();
    const port = docker("port", container, "5432/tcp").stdout.trim().split(":").pop();
    url = `postgresql://engine:engine@127.0.0.1:${port}/engine`;
    for (let attempt = 0; ; attempt += 1) {
      const probe = postgres(url, { max: 1, connect_timeout: 2, onnotice: () => {} });
      const ok = await probe`select 1`.then(() => true, () => false);
      await probe.end({ timeout: 1 });
      if (ok) break;
      if (attempt > 60) throw new Error("postgres did not become ready");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    fixture = await startFixtureServer();
    dir = await tempDir("engine-e2e-");
    const config = loadConfig({ ENGINE_DATABASE_URL: url, ENGINE_DATA_DIR: dir.path, ENGINE_ADMIN_TOKEN: "e2e-admin-token", ENGINE_DISK_STOP_PERCENT: "100" });
    engine = await createEngine(config, { registry: fixtureRegistry(fixture.origin, fixture.host, "2026-10-14"), log: nullLogger });
  }, 120_000);

  afterAll(async () => {
    await engine?.shutdown();
    await fixture?.close();
    await dir?.cleanup();
    if (container) docker("rm", "-f", container);
  });

  it("fetches, stores raw, parses and upserts with provenance", async () => {
    await runJob("fixture-eod-daily");
    const { db } = engine.services;
    const prices = await db.select().from(t.dailyPrices).where(eq(t.dailyPrices.date, "2026-10-14"));
    expect(prices.map((row) => [row.symbol, row.close, row.volume])).toEqual(expect.arrayContaining([["TEST1", 105, 12000], ["TEST2", 51, 3400]]));
    expect(prices.every((row) => row.source === "fixture-eod" && row.rawRef && row.asOf)).toBe(true);

    const [doc] = await db.select().from(t.rawDocuments).where(eq(t.rawDocuments.id, prices[0].rawRef!));
    expect(doc).toMatchObject({ source: "fixture-eod", httpStatus: 200, parseStatus: "PARSED", contentType: "text/csv" });
    expect(new TextDecoder().decode((await engine.services.rawStore.get(doc.r2Key))!)).toBe(FIXTURE_CSV);
    expect(fixture.hits[0].userAgent).toBe(ENGINE_USER_AGENT);

    const [run] = await db.select().from(t.fetchRuns).where(eq(t.fetchRuns.jobId, "fixture-eod-daily"));
    expect(run).toMatchObject({ status: "SUCCEEDED", trigger: "manual", documentsFetched: 1, documentsNew: 1, rowsIngested: 2 });
  });

  it("revalidates with ETag on the next run and stores nothing new", async () => {
    await runJob("fixture-eod-daily");
    expect(fixture.hits.at(-1)?.ifNoneMatch).toMatch(/^"/);
    const docs = await engine.services.db.select().from(t.rawDocuments).where(eq(t.rawDocuments.source, "fixture-eod"));
    expect(docs).toHaveLength(1);
    const files = await readdir(join(dir.path, "raw", "fixture-eod"), { recursive: true });
    expect(files.filter((name) => name.endsWith(".csv"))).toHaveLength(1);
  });

  it("marks a challenged source BLOCKED with evidence and refuses to run it again", async () => {
    await runJob("fixture-blocked");
    const [source] = await engine.services.db.select().from(t.sources).where(eq(t.sources.id, "fixture-blocked"));
    expect(source.status).toBe("BLOCKED");
    expect(source.blockEvidence).toMatchObject({ reason: "CLOUDFLARE_CHALLENGE", status: 403, headers: { "cf-ray": "fixture-SIN" } });
    const hits = fixture.hits.filter((hit) => hit.path === "/challenge").length;
    expect(hits).toBe(1);
    const again = await call("/v1/admin/jobs/fixture-blocked/run", { method: "POST", headers: ADMIN });
    expect(await again.json()).toEqual({ data: { status: "blocked" } });

    const health = (await (await call("/v1/meta/health")).json()) as { data: { sources: Array<{ id: string }> } };
    const byId = Object.fromEntries(health.data.sources.map((row: { id: string }) => [row.id, row]));
    expect(byId["fixture-blocked"]).toMatchObject({ blocked: true, blockReason: "CLOUDFLARE_CHALLENGE" });
    expect(byId["fixture-eod"]).toMatchObject({ status: "OK", blocked: false, rowsIngested: 2 });
  });

  it("resumes the backfill from the cursor stored in the DB", async () => {
    await runJob("fixture-eod-backfill");
    const [cursor] = await engine.services.db.select().from(t.jobCursors).where(eq(t.jobCursors.jobId, "fixture-eod-backfill"));
    expect(cursor.cursor).toMatchObject({ next: "2026-10-07" });
    await runJob("fixture-eod-backfill");
    const days = await engine.services.db.selectDistinct({ date: t.dailyPrices.date }).from(t.dailyPrices);
    expect(days.map((row) => row.date).sort()).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-14"]);
  });

  it("prunes intraday snapshots past retention", async () => {
    const { db } = engine.services;
    const now = Date.now();
    await db.insert(t.intradaySnapshots).values([
      { symbol: "TEST1", ts: new Date(now - 40 * 86_400_000), last: 100, source: "fixture-eod", asOf: new Date(now - 40 * 86_400_000) },
      { symbol: "TEST1", ts: new Date(now - 60_000), last: 101, source: "fixture-eod", asOf: new Date(now - 60_000) },
    ]);
    await runJob("intraday-retention");
    const left = await db.select().from(t.intradaySnapshots).where(and(eq(t.intradaySnapshots.symbol, "TEST1")));
    expect(left.map((row) => row.last)).toEqual([101]);
  });

  it("is ready when the DB is reachable", async () => {
    expect((await call("/ready")).status).toBe(200);
  });
});
