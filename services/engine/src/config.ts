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
});

export type ArjumConfig = { baseUrl: string; apiKey: string; dailyBudget: number; reserve: number };

export type EngineConfig = {
  port: number;
  databaseUrl: string;
  apiToken?: string;
  adminToken?: string;
  dataDir: string;
  diskStopPercent: number;
  fetch: { minIntervalMs: number; concurrency: number };
  intraday: { intervalMinutes: number; retentionDays: number };
  schedulerEnabled: boolean;
  migrateOnStart: boolean;
  /** Null → local-directory fallback under `${dataDir}/raw`. */
  rawS3: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string } | null;
  /** Null → the foreign-flow job is not registered and foreignBuy/foreignSell stay null. */
  arjum: ArjumConfig | null;
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
  return {
    port: e.PORT,
    databaseUrl: e.ENGINE_DATABASE_URL,
    apiToken: e.ENGINE_API_TOKEN,
    adminToken: e.ENGINE_ADMIN_TOKEN,
    dataDir: e.ENGINE_DATA_DIR,
    diskStopPercent: e.ENGINE_DISK_STOP_PERCENT,
    fetch: { minIntervalMs: e.ENGINE_FETCH_MIN_INTERVAL_MS, concurrency: e.ENGINE_FETCH_CONCURRENCY },
    intraday: { intervalMinutes: e.ENGINE_INTRADAY_INTERVAL_MINUTES, retentionDays: e.ENGINE_INTRADAY_RETENTION_DAYS },
    schedulerEnabled: e.ENGINE_SCHEDULER_ENABLED,
    migrateOnStart: e.ENGINE_MIGRATE_ON_START,
    rawS3: s3Set === s3Parts.length
      ? { endpoint: e.ENGINE_RAW_S3_ENDPOINT!, bucket: e.ENGINE_RAW_S3_BUCKET!, accessKeyId: e.ENGINE_RAW_S3_ACCESS_KEY_ID!, secretAccessKey: e.ENGINE_RAW_S3_SECRET_ACCESS_KEY!, region: e.ENGINE_RAW_S3_REGION }
      : null,
    arjum: e.ENGINE_ARJUM_BASE_URL && e.ENGINE_ARJUM_API_KEY
      ? { baseUrl: e.ENGINE_ARJUM_BASE_URL.replace(/\/+$/, ""), apiKey: e.ENGINE_ARJUM_API_KEY, dailyBudget: e.ENGINE_ARJUM_DAILY_BUDGET, reserve: e.ENGINE_ARJUM_RESERVE }
      : null,
  };
}
