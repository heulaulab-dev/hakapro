// Wires config → DB, raw store, fetcher, registry, scheduler and the HTTP handler. Shared by main.ts and the e2e test.
import { mkdir } from "node:fs/promises";
import type { EngineConfig } from "./config";
import { createDb, migrationsDir, runMigrations, waitForDatabase, type EngineDb } from "./db/client";
import { DbCursorStore, DbRawDocumentIndex, DbRunRecorder, DbSourceStateStore, deleteIntradayOlderThan, sourceHealth, syncSources } from "./db/repos";
import { Fetcher } from "./fetch/fetcher";
import { LimiterRegistry } from "./fetch/rate-limit";
import { createRawStore, type RawStore } from "./fetch/raw-store";
import { createApp } from "./http/app";
import { log as defaultLog, type Logger } from "./log";
import { intradayRetentionJob, validateRegistry, type Registry } from "./registry";
import { PauseGuard } from "./schedule/pause";
import { Scheduler } from "./schedule/scheduler";

export type EngineServices = {
  config: EngineConfig;
  db: EngineDb;
  fetcher: Fetcher;
  rawStore: RawStore;
  documents: DbRawDocumentIndex;
  sourceState: DbSourceStateStore;
  log: Logger;
};

/** Production registry for E1: no third-party sources yet (E2/E3 after discovery), only housekeeping jobs. */
export function defaultRegistry(services: EngineServices): Registry {
  return {
    sources: [],
    jobs: [
      intradayRetentionJob({
        retentionDays: services.config.intraday.retentionDays,
        deleteOlderThan: (cutoff, limit) => deleteIntradayOlderThan(services.db, cutoff, limit),
      }),
    ],
  };
}

export async function createEngine(config: EngineConfig, options: { registry?: (services: EngineServices) => Registry; log?: Logger; fetch?: typeof fetch } = {}) {
  const log = options.log ?? defaultLog;
  await mkdir(config.dataDir, { recursive: true });
  await waitForDatabase(config.databaseUrl);
  if (config.migrateOnStart) {
    await runMigrations(config.databaseUrl, migrationsDir());
    log.info("engine_migrations_applied");
  }
  const { db, ping, close } = createDb(config.databaseUrl);
  const rawStore = createRawStore(config.rawS3, config.dataDir);
  const documents = new DbRawDocumentIndex(db);
  const sourceState = new DbSourceStateStore(db);
  const fetcher = new Fetcher({ rawStore, documents, sourceState, limiters: new LimiterRegistry(), fetch: options.fetch });
  const services: EngineServices = { config, db, fetcher, rawStore, documents, sourceState, log };

  const registry = validateRegistry((options.registry ?? defaultRegistry)(services));
  await syncSources(db, registry.sources);

  const pause = new PauseGuard(config.dataDir, config.diskStopPercent);
  const scheduler = new Scheduler({ jobs: registry.jobs, pause, runs: new DbRunRecorder(db), cursors: new DbCursorStore(db), sourceState, log });
  const app = createApp({
    apiToken: config.apiToken, adminToken: config.adminToken, ping, pause, scheduler, rawStoreKind: rawStore.kind, log,
    sourceHealth: () => sourceHealth(db), unblockSource: (id) => sourceState.unblock(id),
  });

  return {
    app, scheduler, services, registry,
    async shutdown() {
      scheduler.stop();
      await scheduler.drain();
      await close();
    },
  };
}
