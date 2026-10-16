// Wires config → DB, raw store, fetcher, registry, scheduler and the HTTP handler. Shared by main.ts and the e2e test.
import { mkdir } from "node:fs/promises";
import type { EngineConfig } from "./config";
import { createDb, migrationsDir, runMigrations, waitForDatabase, type EngineDb } from "./db/client";
import { recentEodSessions } from "./db/ingest";
import { deleteNewsOlderThan } from "./db/market-info";
import { DbMarketStore } from "./db/market-store";
import { DbCursorStore, DbRawDocumentIndex, DbRunRecorder, DbSourceStateStore, deleteIntradayOlderThan, sourceHealth, syncSources } from "./db/repos";
import { Fetcher } from "./fetch/fetcher";
import { LimiterRegistry } from "./fetch/rate-limit";
import { createRawStore, type RawStore } from "./fetch/raw-store";
import { createApp } from "./http/app";
import { eodBackfillJob, eodDailyJob } from "./jobs/eod";
import { foreignFlowJob } from "./jobs/foreign";
import { fundamentalsJob } from "./jobs/fundamentals";
import { ratiosJob } from "./jobs/ratios";
import { indicesEodJob } from "./jobs/indices";
import { intradayJob } from "./jobs/intraday";
import { biRateJob, jisdorJob } from "./jobs/macro";
import { newsJob } from "./jobs/news";
import { universeJob } from "./jobs/universe";
import { log as defaultLog, type Logger } from "./log";
import { intradayRetentionJob, newsRetentionJob, validateRegistry, type Registry } from "./registry";
import { PauseGuard } from "./schedule/pause";
import { Scheduler } from "./schedule/scheduler";
import { engineSources } from "./sources";
import { NEWS_FEEDS } from "./sources/news";

export type EngineServices = {
  config: EngineConfig;
  db: EngineDb;
  fetcher: Fetcher;
  rawStore: RawStore;
  documents: DbRawDocumentIndex;
  sourceState: DbSourceStateStore;
  log: Logger;
  now: () => Date;
};

/**
 * Production registry (E2/E2b/E3, DATA-ENGINE.md §5.11). Schedules are WIB:
 *   intraday       every ENGINE_INTRADAY_INTERVAL_MINUTES inside IDX sessions   TradingView market + index scans
 *   universe       16:35 trading days                                           TradingView scan + Pasardana GetAll
 *   indices-eod    16:35 trading days                                           TradingView index scan
 *   eod-daily      16:45, 18:45, 20:45 trading days (20:45 finalizes/STALE)     Yahoo range=5d per symbol + ^JKSE
 *   foreign-flow   19:00, 21:00 trading days (only with ENGINE_ARJUM_*)          arjum /api/history, budgeted
 *   eod-backfill   every 10 min 19:00–05:59, background                          Yahoo from 2020-01-01 per symbol
 *   intraday-retention 02:30, background                                        prunes intraday tables
 *   news           every ENGINE_NEWS_INTERVAL_MINUTES 06:00–22:00, every day   4 outlets' RSS (5 feeds), conditional GET
 *   news-retention 02:45, background                                            prunes news_items past ENGINE_NEWS_RETENTION_DAYS
 *   macro-jisdor   17:00 daily                                                  BI JISDOR table (first page)
 *   macro-bi-rate  17:05 daily                                                  BI-Rate table (first page)
 *   fundamentals   every 10 min at :05, 19:00–05:59, background, low priority  Yahoo fundamentals per symbol, weekly
 *                                                                               cycle + earnings-season catch-up
 *   ratios         06:15, 17:15, 21:15 daily (no network)                      derived ratios → stock_ratios
 */
export function defaultRegistry(services: EngineServices): Registry {
  const sources = engineSources(services.config.arjum);
  const jobServices = { db: services.db, fetcher: services.fetcher, documents: services.documents, sourceState: services.sourceState, log: services.log, now: services.now };
  return {
    sources: [sources.tradingview, sources.yahoo, sources.pasardana, ...(sources.arjum ? [sources.arjum] : []), ...sources.news, sources.bi, sources.yahooFundamentals],
    jobs: [
      universeJob(jobServices, { tradingview: sources.tradingview, pasardana: sources.pasardana }),
      indicesEodJob(jobServices, sources.tradingview),
      eodDailyJob(jobServices, sources.yahoo),
      eodBackfillJob(jobServices, sources.yahoo),
      ...(sources.arjum && services.config.arjum ? [foreignFlowJob(jobServices, sources.arjum, services.config.arjum)] : []),
      intradayJob(jobServices, sources.tradingview, services.config.intraday.intervalMinutes),
      intradayRetentionJob({
        retentionDays: services.config.intraday.retentionDays,
        deleteOlderThan: (cutoff, limit) => deleteIntradayOlderThan(services.db, cutoff, limit),
        now: services.now,
      }),
      newsJob(jobServices, NEWS_FEEDS.map((feed) => ({ ...feed, source: sources.news.find((source) => source.id === feed.sourceId)! })), {
        everyMinutes: services.config.news.intervalMinutes, retentionDays: services.config.news.retentionDays,
      }),
      newsRetentionJob({
        retentionDays: services.config.news.retentionDays,
        deleteOlderThan: (cutoff, limit) => deleteNewsOlderThan(services.db, cutoff, limit),
        now: services.now,
      }),
      jisdorJob(jobServices, sources.bi),
      biRateJob(jobServices, sources.bi),
      fundamentalsJob(jobServices, sources.yahooFundamentals, { hostSources: [sources.yahoo.id] }),
      ratiosJob(jobServices, { fundamentals: sources.yahooFundamentals.id, chart: sources.yahoo.id }),
    ],
  };
}

export type EngineOptions = {
  registry?: (services: EngineServices) => Registry;
  log?: Logger;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Per-host limiters; tests pass one on a virtual clock so spacing is enforced without real waiting. */
  limiters?: LimiterRegistry;
};

export async function createEngine(config: EngineConfig, options: EngineOptions = {}) {
  const log = options.log ?? defaultLog;
  const now = options.now ?? (() => new Date());
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
  const fetcher = new Fetcher({ rawStore, documents, sourceState, limiters: options.limiters ?? new LimiterRegistry(), fetch: options.fetch });
  const services: EngineServices = { config, db, fetcher, rawStore, documents, sourceState, log, now };

  const registry = validateRegistry((options.registry ?? defaultRegistry)(services));
  await syncSources(db, registry.sources);

  const pause = new PauseGuard(config.dataDir, config.diskStopPercent);
  const scheduler = new Scheduler({ jobs: registry.jobs, pause, runs: new DbRunRecorder(db), cursors: new DbCursorStore(db), sourceState, log, now });
  const app = createApp({
    apiToken: config.apiToken, adminToken: config.adminToken, ping, pause, scheduler, rawStoreKind: rawStore.kind, log, now,
    sourceHealth: () => sourceHealth(db), unblockSource: (id) => sourceState.unblock(id),
    market: new DbMarketStore(db),
    eodSessions: async () => (await recentEodSessions(db)).map((row) => ({
      date: row.date, status: row.status, expected: row.expected, present: row.present, attempts: row.attempts, finalizedAt: row.finalizedAt?.toISOString() ?? null,
    })),
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
