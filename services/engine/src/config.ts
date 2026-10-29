import { z } from "zod";

const flag = (fallback: boolean) => z.enum(["true", "false", "1", "0", ""]).optional().transform((value) => (value ? value === "true" || value === "1" : fallback));
const optionalSecret = z.string().optional().transform((value) => (value ? value : undefined));

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  ENGINE_DATABASE_URL: z.string().min(1, "ENGINE_DATABASE_URL is required"),
  ENGINE_API_TOKEN: optionalSecret,
  ENGINE_ADMIN_TOKEN: optionalSecret,
  ENGINE_DATA_DIR: z.string().min(1).default(".engine-data"),
  ENGINE_DISK_STOP_PERCENT: z.coerce.number().min(1).max(100).default(85),
  ENGINE_FETCH_MIN_INTERVAL_MS: z.coerce.number().int().min(100).default(2000),
  ENGINE_FETCH_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  // Minimum 1 minute: TradingView's scanner is 10 min delayed and cached, so polling faster gains nothing (§5.11).
  ENGINE_INTRADAY_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(60).default(5),
  ENGINE_INTRADAY_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  // News RSS polling inside 06:00–22:00 WIB (§5.11 item 4); at least 5 minutes, the feeds update in minutes at most.
  ENGINE_NEWS_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(240).default(15),
  ENGINE_NEWS_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(180),
  ENGINE_SCHEDULER_ENABLED: flag(true),
  ENGINE_MIGRATE_ON_START: flag(true),
  ENGINE_RAW_S3_ENDPOINT: optionalSecret,
  ENGINE_RAW_S3_BUCKET: optionalSecret,
  ENGINE_RAW_S3_ACCESS_KEY_ID: optionalSecret,
  ENGINE_RAW_S3_SECRET_ACCESS_KEY: optionalSecret,
  ENGINE_RAW_S3_REGION: z.string().min(1).default("auto"),
  // arjum foreign flow (§8.5c): the same provider and key as the app's HEULATRADE_MARKET_API_BASE_URL / _KEY.
  ENGINE_ARJUM_BASE_URL: optionalSecret,
  ENGINE_ARJUM_API_KEY: optionalSecret,
  ENGINE_ARJUM_DAILY_BUDGET: z.coerce.number().int().min(0).max(1000).default(600),
  ENGINE_ARJUM_RESERVE: z.coerce.number().int().min(0).max(1000).default(400),
  // Market-wide insider feed (one /api/insiders call per symbol): 0 (the default) leaves the job unregistered. Every
  // call comes out of the same 1000/day key quota, so it competes with foreign flow and the app (see README).
  ENGINE_ARJUM_INSIDER_BUDGET: z.coerce.number().int().min(0).max(1000).default(0),
  ENGINE_ARJUM_INSIDER_REVISIT_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  // When explicitly enabled, the existing authenticated history endpoint is also the engine's EOD OHLCV source.
  // Keep off until the provider plan permits this collection, storage, and app display use.
  ENGINE_ARJUM_EOD_ENABLED: flag(false),
  // Ownership uploads (E6, §8.5d): file size cap, and the HAKA-34 draft estimate on /v1 (off until the owner approves).
  ENGINE_OWNERSHIP_MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(20),
  ENGINE_FREE_FLOAT_ENABLED: flag(false),
  ENGINE_KSEI_OWNERSHIP_ENABLED: flag(true),
  ENGINE_KSEI_OWNERSHIP_MIRROR_URL: z.string().url().default("https://github.com/fzn0x/idx/releases/download/ownership-data/index.json"),
  // E4 strategy scans on the HAKA-17 DRAFT rules (not owner-approved): off by default (job not registered, /v1/strategies empty).
  ENGINE_STRATEGY_SCANS_ENABLED: flag(false),
  // IDX /primary historical index backfill (GetIndexSummary). Off by default; enabling it starts the curl_cffi worker.
  IDX_BEI_ENABLED: flag(false),
  IDX_BEI_API_URL: z.string().url().default("http://idx-bei:8000"),
  ENGINE_IDX_PRIMARY_ENABLED: flag(false),
  ENGINE_IDX_PRIMARY_BASE_URL: z.string().optional(),
  ENGINE_IDX_PRIMARY_PYTHON: z.string().min(1).default("python3"),
  ENGINE_IDX_PRIMARY_WORKER_SCRIPT: z.string().optional(),
  ENGINE_IDX_PRIMARY_MAX_RETRIES: z.coerce.number().int().min(0).max(8).default(3),
  ENGINE_IDX_PRIMARY_TIMEOUT_SECONDS: z.coerce.number().positive().max(120).default(30),
  ENGINE_IDX_PRIMARY_DELAY_SECONDS: z.coerce.number().min(0).max(30).default(2),
  ENGINE_IDX_PRIMARY_IMPERSONATE: z.string().min(1).default("chrome"),
  // Changing this version deliberately replays IDX history from BACKFILL_START; keep stable after rollout.
  ENGINE_IDX_PRIMARY_BACKFILL_REVISION: z.string().min(1).max(64).default("3"),
  // Ticker logos proxied from TradingView's logo CDN (HAKA-74). TradingView is accepted for the internal experiment
  // only (DATA-ENGINE.md §8 decision 6), so this is off by default: no logo source is registered and /v1/logos answers
  // 404 DISABLED. Pair with the app's NEXT_PUBLIC_TICKER_LOGOS=1.
  ENGINE_TICKER_LOGOS_ENABLED: flag(false),
});

/** arjum's daily request quota for one key, shared by the engine (foreign flow, insider feed) and the app environments. */
export const ARJUM_DAILY_QUOTA = 1000;

export type ArjumConfig = {
  baseUrl: string; apiKey: string; dailyBudget: number; reserve: number; eodEnabled: boolean;
  /** Insider-feed calls per WIB day (0 = job not registered) and the days before a symbol is read again. */
  insiderBudget: number; insiderRevisitDays: number;
};

export type EngineConfig = {
  port: number;
  databaseUrl: string;
  apiToken?: string;
  adminToken?: string;
  dataDir: string;
  diskStopPercent: number;
  fetch: { minIntervalMs: number; concurrency: number };
  intraday: { intervalMinutes: number; retentionDays: number };
  news: { intervalMinutes: number; retentionDays: number };
  schedulerEnabled: boolean;
  migrateOnStart: boolean;
  /** Null → local-directory fallback under `${dataDir}/raw`. */
  rawS3: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string } | null;
  /** Null → the foreign-flow and insider-feed jobs are not registered and foreignBuy/foreignSell stay null. */
  arjum: ArjumConfig | null;
  /** Ownership uploads: largest accepted file, and whether the free-float draft estimate is served. */
  ownership: { maxUploadBytes: number; freeFloatEnabled: boolean };
  kseiOwnership: { enabled: boolean; mirrorUrl: string };
  /** false → strategy-scan-eod is not registered and /v1/strategies serves the empty UNAVAILABLE board. */
  strategyScans: { enabled: boolean };
  /** IDX /primary historical index backfill. Disabled → the backfill job and its source are not registered. */
  idxBei?: { enabled: boolean; baseUrl: string };
  idxPrimary: { enabled: boolean; baseUrl: string; python: string; workerScript?: string; maxRetries: number; timeoutSeconds: number; delaySeconds: number; impersonate: string; backfillRevision: string };
  /** false → the logo CDN source is not registered and /v1/logos/{s} answers 404 DISABLED. */
  tickerLogos: { enabled: boolean };
};

/** Parses env; error messages name variables, never values. */
export function loadConfig(env: Record<string, string | undefined> = process.env): EngineConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid engine configuration: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  const e = parsed.data;
  const s3Parts = [e.ENGINE_RAW_S3_ENDPOINT, e.ENGINE_RAW_S3_BUCKET, e.ENGINE_RAW_S3_ACCESS_KEY_ID, e.ENGINE_RAW_S3_SECRET_ACCESS_KEY];
  const s3Set = s3Parts.filter(Boolean).length;
  if (s3Set > 0 && s3Set < s3Parts.length) {
    throw new Error("Invalid engine configuration: ENGINE_RAW_S3_ENDPOINT, _BUCKET, _ACCESS_KEY_ID and _SECRET_ACCESS_KEY must be set together");
  }
  if (Boolean(e.ENGINE_ARJUM_BASE_URL) !== Boolean(e.ENGINE_ARJUM_API_KEY)) {
    throw new Error("Invalid engine configuration: ENGINE_ARJUM_BASE_URL and ENGINE_ARJUM_API_KEY must be set together");
  }
  if (e.ENGINE_ARJUM_BASE_URL && !/^https?:\/\/[^/]/.test(e.ENGINE_ARJUM_BASE_URL)) {
    throw new Error("Invalid engine configuration: ENGINE_ARJUM_BASE_URL must be an http(s) URL");
  }
  if (e.ENGINE_IDX_PRIMARY_BASE_URL && !/^https?:\/\/[^/]/.test(e.ENGINE_IDX_PRIMARY_BASE_URL)) {
    throw new Error("Invalid engine configuration: ENGINE_IDX_PRIMARY_BASE_URL must be an http(s) URL");
  }
  const kseiMirror = new URL(e.ENGINE_KSEI_OWNERSHIP_MIRROR_URL);
  if (kseiMirror.origin !== "https://github.com" || kseiMirror.pathname !== "/fzn0x/idx/releases/download/ownership-data/index.json" || kseiMirror.search || kseiMirror.hash) {
    throw new Error("Invalid engine configuration: ENGINE_KSEI_OWNERSHIP_MIRROR_URL must be the pinned ownership-data release");
  }
  // The two engine budgets together must fit in what the reserve leaves of the shared quota. Checked only when the
  // insider feed is on, so configurations from before it existed keep loading unchanged.
  const aboveReserve = ARJUM_DAILY_QUOTA - e.ENGINE_ARJUM_RESERVE;
  if (e.ENGINE_ARJUM_INSIDER_BUDGET > 0 && e.ENGINE_ARJUM_DAILY_BUDGET + e.ENGINE_ARJUM_INSIDER_BUDGET > aboveReserve) {
    throw new Error(
      `Invalid engine configuration: ENGINE_ARJUM_DAILY_BUDGET + ENGINE_ARJUM_INSIDER_BUDGET (${e.ENGINE_ARJUM_DAILY_BUDGET} + ${e.ENGINE_ARJUM_INSIDER_BUDGET}) `
      + `must not exceed ${ARJUM_DAILY_QUOTA} - ENGINE_ARJUM_RESERVE (${aboveReserve}); lower a budget or the reserve`,
    );
  }
  return {
    port: e.PORT,
    databaseUrl: e.ENGINE_DATABASE_URL,
    apiToken: e.ENGINE_API_TOKEN,
    adminToken: e.ENGINE_ADMIN_TOKEN,
    dataDir: e.ENGINE_DATA_DIR,
    diskStopPercent: e.ENGINE_DISK_STOP_PERCENT,
    fetch: { minIntervalMs: e.ENGINE_FETCH_MIN_INTERVAL_MS, concurrency: e.ENGINE_FETCH_CONCURRENCY },
    intraday: { intervalMinutes: e.ENGINE_INTRADAY_INTERVAL_MINUTES, retentionDays: e.ENGINE_INTRADAY_RETENTION_DAYS },
    news: { intervalMinutes: e.ENGINE_NEWS_INTERVAL_MINUTES, retentionDays: e.ENGINE_NEWS_RETENTION_DAYS },
    schedulerEnabled: e.ENGINE_SCHEDULER_ENABLED,
    migrateOnStart: e.ENGINE_MIGRATE_ON_START,
    rawS3: s3Set === s3Parts.length
      ? { endpoint: e.ENGINE_RAW_S3_ENDPOINT!, bucket: e.ENGINE_RAW_S3_BUCKET!, accessKeyId: e.ENGINE_RAW_S3_ACCESS_KEY_ID!, secretAccessKey: e.ENGINE_RAW_S3_SECRET_ACCESS_KEY!, region: e.ENGINE_RAW_S3_REGION }
      : null,
    arjum: e.ENGINE_ARJUM_BASE_URL && e.ENGINE_ARJUM_API_KEY
      ? {
        baseUrl: e.ENGINE_ARJUM_BASE_URL.replace(/\/+$/, ""), apiKey: e.ENGINE_ARJUM_API_KEY, dailyBudget: e.ENGINE_ARJUM_DAILY_BUDGET, reserve: e.ENGINE_ARJUM_RESERVE,
        eodEnabled: e.ENGINE_ARJUM_EOD_ENABLED, insiderBudget: e.ENGINE_ARJUM_INSIDER_BUDGET, insiderRevisitDays: e.ENGINE_ARJUM_INSIDER_REVISIT_DAYS,
      }
      : null,
    ownership: { maxUploadBytes: e.ENGINE_OWNERSHIP_MAX_UPLOAD_MB * 1024 * 1024, freeFloatEnabled: e.ENGINE_FREE_FLOAT_ENABLED },
    kseiOwnership: { enabled: e.ENGINE_KSEI_OWNERSHIP_ENABLED, mirrorUrl: e.ENGINE_KSEI_OWNERSHIP_MIRROR_URL },
    strategyScans: { enabled: e.ENGINE_STRATEGY_SCANS_ENABLED },
    idxBei: { enabled: e.IDX_BEI_ENABLED, baseUrl: e.IDX_BEI_API_URL },
    tickerLogos: { enabled: e.ENGINE_TICKER_LOGOS_ENABLED },
    idxPrimary: {
      enabled: e.ENGINE_IDX_PRIMARY_ENABLED,
      baseUrl: (e.ENGINE_IDX_PRIMARY_BASE_URL ?? "https://www.idx.co.id/primary").replace(/\/+$/, ""),
      python: e.ENGINE_IDX_PRIMARY_PYTHON,
      workerScript: e.ENGINE_IDX_PRIMARY_WORKER_SCRIPT,
      maxRetries: e.ENGINE_IDX_PRIMARY_MAX_RETRIES,
      timeoutSeconds: e.ENGINE_IDX_PRIMARY_TIMEOUT_SECONDS,
      delaySeconds: e.ENGINE_IDX_PRIMARY_DELAY_SECONDS,
      impersonate: e.ENGINE_IDX_PRIMARY_IMPERSONATE,
      backfillRevision: e.ENGINE_IDX_PRIMARY_BACKFILL_REVISION,
    },
  };
}
