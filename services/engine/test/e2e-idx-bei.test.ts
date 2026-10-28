// IDX-BEI → engine → PostgreSQL → /v1 against a throwaway PostgreSQL (Docker) and a local HTTP stand-in for the
// private IDX-BEI service that serves the recorded company snapshot. Opt-in (`bun run engine:test:e2e`).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idxBeiEnvelope, profileSchema } from "@/server/schemas/idx-bei";
import * as t from "../db/schema";
import { loadConfig } from "../src/config";
import { upsertIdxIssuerProfile } from "../src/db/idx-issuer";
import { createEngine } from "../src/engine";
import { LimiterRegistry } from "../src/fetch/rate-limit";
import { nullLogger } from "../src/log";
import { IDX_BEI_COMPANY_SNAPSHOT_PATH, IDX_BEI_SOURCE_ID } from "../src/sources/idx-bei-api";
import { IDX_BEI_ISSUER_IMPORT_ID } from "../src/jobs/idx-bei-issuer-import";
import snapshotFixture from "../src/sources/fixtures/idx-bei-company-snapshot.2026-08-26.json";
import { dockerEnabled, startPostgres, type TestPostgres } from "./postgres";
import { startSourceWorld, type SourceWorld } from "./source-fixtures";
import { fakeClock, tempDir, wib } from "./support";

const enabled = dockerEnabled();

describe.skipIf(!enabled)("IDX-BEI issuer profiles (docker postgres + local IDX-BEI)", { timeout: 60_000 }, () => {
  let pg: TestPostgres;
  let world: SourceWorld;
  let idxBei: Server;
  let idxBeiOrigin = "";
  let snapshot: unknown = snapshotFixture;
  let snapshotStatus = 200;
  const cleanups: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    pg = await startPostgres();
    world = await startSourceWorld();
    idxBei = createServer((request, response) => {
      if (request.url !== IDX_BEI_COMPANY_SNAPSHOT_PATH || request.method !== "GET") { response.writeHead(404).end(); return; }
      response.writeHead(snapshotStatus, { "content-type": "application/json" }).end(snapshotStatus === 200 ? JSON.stringify(snapshot) : "{}");
    });
    await new Promise<void>((resolve) => idxBei.listen(0, "127.0.0.1", resolve));
    idxBeiOrigin = `http://127.0.0.1:${(idxBei.address() as AddressInfo).port}`;
  }, 120_000);

  afterAll(async () => {
    for (const cleanup of cleanups) await cleanup();
    await new Promise((resolve) => idxBei?.close(resolve));
    await world?.close();
    pg?.stop();
  });

  async function engineOn(url: string, dir: string) {
    const config = loadConfig({
      ENGINE_DATABASE_URL: url, ENGINE_DATA_DIR: dir, ENGINE_ADMIN_TOKEN: "e2e-admin", ENGINE_DISK_STOP_PERCENT: "100",
      IDX_BEI_ENABLED: "true", IDX_BEI_API_URL: idxBeiOrigin,
    });
    const engine = await createEngine(config, { fetch: world.fetch, log: nullLogger, now: () => wib("2026-10-28", "07:30"), limiters: new LimiterRegistry(fakeClock(0)) });
    const run = async (id: string) => {
      expect((await engine.scheduler.trigger(id)).status, id).toBe("started");
      await engine.scheduler.waitFor(id);
      return engine.scheduler.status().find((job) => job.id === id)!;
    };
    const profile = async (symbol: string) => engine.app(new Request(`http://engine.test/v1/stocks/${symbol}/profile`));
    return { engine, db: engine.services.db, run, profile };
  }

  it("imports the snapshot, serves it with provenance, stays idempotent, keeps native rows and survives a restart", async () => {
    const url = await pg.createDatabase("engine_idx_bei");
    const dir = await tempDir("engine-idx-bei-");
    cleanups.push(dir.cleanup);
    const first = await engineOn(url, dir.path);

    // Registered only because IDX_BEI_ENABLED=true.
    expect(first.engine.registry.sources.map((source) => source.id)).toContain(IDX_BEI_SOURCE_ID);
    expect(first.engine.scheduler.status().find((job) => job.id === IDX_BEI_ISSUER_IMPORT_ID)).toMatchObject({ sourceId: IDX_BEI_SOURCE_ID, trigger: { kind: "cron", spec: "20 7 * * *" } });

    // Universe first: issuer profiles reference the securities directory (BBCA, TLKM, GOTO… from the fixture world).
    expect((await first.run("universe")).lastStatus).toBe("SUCCEEDED");
    expect((await first.profile("BBCA")).status).toBe(404);

    expect((await first.run(IDX_BEI_ISSUER_IMPORT_ID)).lastStatus).toBe("SUCCEEDED");
    const stored = await first.db.select().from(t.idxIssuerProfiles).orderBy(asc(t.idxIssuerProfiles.symbol));
    // EMAS and ZZZZ are not in this securities directory; GOTOM is not GOTO.
    expect(stored.map((row) => [row.symbol, row.source, row.asOf.toISOString()])).toEqual([
      ["BBCA", IDX_BEI_SOURCE_ID, "2026-08-26T10:31:48.000Z"],
      ["TLKM", IDX_BEI_SOURCE_ID, "2026-08-26T10:31:48.000Z"],
    ]);

    // HakaPro API: the shared contract validates; the age of the snapshot is stated; no snapshot price or verdict leaks.
    const response = await first.profile("BBCA");
    expect(response.status).toBe(200);
    const raw = await response.text();
    const body = idxBeiEnvelope(profileSchema).parse(JSON.parse(raw));
    expect(body.meta.dataAsOf).toBe("2026-08-26T17:31:48+07:00");
    expect(body.meta.freshness).toBe("HISTORICAL");
    expect(body.data.companyName).toBe("Contoh Bank Nusantara Tbk.");
    expect(body.data.provenance).toEqual({ source: IDX_BEI_SOURCE_ID, capturedAt: "2026-08-26T17:31:48+07:00", retrievedAt: "2026-10-28T07:30:00+07:00" });
    expect(body.data.directors).toEqual([{ Nama: "Director One", Jabatan: "PRESIDEN DIREKTUR" }, { Nama: "Director Two", Jabatan: "WAKIL PRESIDEN DIREKTUR" }]);
    expect(body.data.shareholders[0]).toEqual({ Nama: "PT Contoh Induk Investama", Persentase: 55.5 });
    for (const forbidden of ["ai_thesis", "dca_verdict", "ACCUMULATE", "1234", "previous_price"]) expect(raw).not.toContain(forbidden);

    // Idempotent: the same snapshot again changes nothing and adds no rows.
    const health = async () => (await first.db.select().from(t.sources).where(eq(t.sources.id, IDX_BEI_SOURCE_ID)))[0];
    const rowsBefore = (await health()).rowsIngested;
    expect((await first.run(IDX_BEI_ISSUER_IMPORT_ID)).lastStatus).toBe("SUCCEEDED");
    expect((await health()).rowsIngested).toBe(rowsBefore);
    expect(await first.db.select().from(t.idxIssuerProfiles)).toHaveLength(2);

    // A native IDX row is authoritative; a newer snapshot updates only IDX-BEI rows.
    await upsertIdxIssuerProfile(first.db, { symbol: "TLKM", language: "id-id", profile: { NamaEmiten: "Native" }, directors: [], commissioners: [], auditCommittee: [], shareholders: [], subsidiaries: [] },
      { source: "idx-primary", asOf: wib("2026-10-27", "17:00"), rawRef: null });
    snapshot = { ...snapshotFixture, last_updated: "2026-09-30 08:00:00" };
    expect((await first.run(IDX_BEI_ISSUER_IMPORT_ID)).lastStatus).toBe("SUCCEEDED");
    const afterNewer = Object.fromEntries((await first.db.select().from(t.idxIssuerProfiles)).map((row) => [row.symbol, row]));
    expect(afterNewer.TLKM).toMatchObject({ source: "idx-primary", profile: { NamaEmiten: "Native" } });
    expect(afterNewer.BBCA.asOf.toISOString()).toBe("2026-09-30T01:00:00.000Z");

    // An older snapshot never rolls a row back.
    snapshot = { ...snapshotFixture, last_updated: "2026-07-01 08:00:00" };
    expect((await first.run(IDX_BEI_ISSUER_IMPORT_ID)).lastStatus).toBe("SUCCEEDED");
    expect((await first.db.select().from(t.idxIssuerProfiles).where(eq(t.idxIssuerProfiles.symbol, "BBCA")))[0].asOf.toISOString()).toBe("2026-09-30T01:00:00.000Z");

    // Failure: IDX-BEI down → the job fails and records it; stored profiles are untouched and still served.
    snapshotStatus = 503;
    const failed = await first.run(IDX_BEI_ISSUER_IMPORT_ID);
    expect(failed.lastStatus).toBe("FAILED");
    expect((await health()).lastError).toContain("IDX-BEI company snapshot unavailable");
    expect((await first.profile("BBCA")).status).toBe(200);
    snapshotStatus = 200;
    await first.engine.shutdown();

    // Persistence: a new engine process on the same database serves the same rows.
    const second = await engineOn(url, dir.path);
    cleanups.push(() => second.engine.shutdown());
    const again = idxBeiEnvelope(profileSchema).parse(await (await second.profile("BBCA")).json());
    expect(again.data.provenance?.source).toBe(IDX_BEI_SOURCE_ID);
    expect(again.meta.dataAsOf).toBe("2026-09-30T08:00:00+07:00");
  });
});
