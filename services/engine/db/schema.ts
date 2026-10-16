// Engine database (DATA-ENGINE.md §6). Separate from the app database: own PostgreSQL, own migrations.
// Every data table carries `source`, `as_of` and `raw_ref` (the raw document it was parsed from).
import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, unique, uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const price = (name: string) => numeric(name, { precision: 18, scale: 4, mode: "number" });
const count = (name: string) => bigint(name, { mode: "number" });
/** Fraction, not percent (0.0111 = 1.11%), as in the idx-bei contract. */
const fraction = (name: string) => numeric(name, { precision: 14, scale: 8, mode: "number" });

export const SOURCE_STATUSES = ["NEVER_RUN", "OK", "ERROR", "BLOCKED"] as const;
export const PARSE_STATUSES = ["PENDING", "PARSED", "FAILED", "SKIPPED"] as const;
export const RUN_STATUSES = ["RUNNING", "SUCCEEDED", "FAILED", "BLOCKED", "YIELDED"] as const;
export const SESSION_STATUSES = ["PENDING", "PARTIAL", "COMPLETE", "STALE"] as const;

export type SourcePolicy = { minIntervalMs: number; concurrency: number; schedule?: string };
export type BlockEvidence = { reason: string; url: string; status: number | null; markers: string[]; headers: Record<string, string>; detectedAt: string };

export const sources = pgTable("sources", {
  id: text("id").primaryKey(),
  host: text("host").notNull(),
  policy: jsonb("policy").$type<SourcePolicy>().notNull(),
  status: text("status", { enum: SOURCE_STATUSES }).notNull().default("NEVER_RUN"),
  lastSuccessAt: ts("last_success_at"),
  lastErrorAt: ts("last_error_at"),
  lastError: text("last_error"),
  blockedAt: ts("blocked_at"),
  blockEvidence: jsonb("block_evidence").$type<BlockEvidence>(),
  rowsIngested: count("rows_ingested").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const fetchRuns = pgTable("fetch_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: text("job_id").notNull(),
  sourceId: text("source_id").references(() => sources.id),
  trigger: text("trigger", { enum: ["schedule", "manual"] }).notNull(),
  status: text("status", { enum: RUN_STATUSES }).notNull().default("RUNNING"),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
  documentsFetched: integer("documents_fetched").notNull().default(0),
  documentsNew: integer("documents_new").notNull().default(0),
  rowsIngested: integer("rows_ingested").notNull().default(0),
  error: text("error"),
}, (t) => [index("fetch_runs_job_started").on(t.jobId, t.startedAt)]);

export const rawDocuments = pgTable("raw_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull().references(() => sources.id),
  url: text("url").notNull(),
  fetchedAt: ts("fetched_at").notNull(),
  httpStatus: integer("http_status").notNull(),
  sha256: text("sha256").notNull(),
  /** Raw store key (R2 object key, or a path under the local fallback directory). */
  r2Key: text("r2_key").notNull(),
  contentType: text("content_type"),
  byteSize: integer("byte_size").notNull(),
  etag: text("etag"),
  lastModified: text("last_modified"),
  parseStatus: text("parse_status", { enum: PARSE_STATUSES }).notNull().default("PENDING"),
  parseError: text("parse_error"),
  fetchRunId: uuid("fetch_run_id").references(() => fetchRuns.id),
}, (t) => [
  unique("raw_documents_url_sha256").on(t.url, t.sha256),
  index("raw_documents_url_fetched").on(t.url, t.fetchedAt),
  index("raw_documents_source_fetched").on(t.source, t.fetchedAt),
]);

/** Resumable cursors for long-running jobs (e.g. the EOD backfill from 2020-01-01). */
export const jobCursors = pgTable("job_cursors", {
  jobId: text("job_id").primaryKey(),
  cursor: jsonb("cursor").$type<Record<string, unknown>>().notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

const provenance = {
  source: text("source").notNull(),
  asOf: ts("as_of").notNull(),
  rawRef: uuid("raw_ref").references(() => rawDocuments.id),
};

export const securities = pgTable("securities", {
  symbol: text("symbol").primaryKey(),
  name: text("name").notNull(),
  board: text("board"),
  notation: text("notation"),
  sector: text("sector"),
  subsector: text("subsector"),
  listingDate: date("listing_date"),
  industry: text("industry"),
  sharesOutstanding: count("shares_outstanding"),
  marketCap: count("market_cap"),
  /** Percent units (18.18 = 18.18%), as Pasardana publishes it. */
  freeFloatPct: numeric("free_float_pct", { precision: 9, scale: 4, mode: "number" }),
  active: boolean("active").notNull().default(true),
  ...provenance,
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const dailyPrices = pgTable("daily_prices", {
  symbol: text("symbol").notNull(),
  date: date("date").notNull(),
  open: price("open"),
  high: price("high"),
  low: price("low"),
  close: price("close").notNull(),
  previousClose: price("previous_close"),
  volume: count("volume"),
  value: count("value"),
  frequency: count("frequency"),
  foreignBuy: count("foreign_buy"),
  foreignSell: count("foreign_sell"),
  /** Split- and dividend-adjusted close where the source publishes one (Yahoo `adjclose`). */
  adjClose: price("adj_close"),
  // `source`/`raw_ref` describe the OHLCV; value/frequency and foreign flow can come from other sources.
  valueSource: text("value_source"),
  valueRawRef: uuid("value_raw_ref").references(() => rawDocuments.id),
  foreignSource: text("foreign_source"),
  foreignAsOf: ts("foreign_as_of"),
  foreignRawRef: uuid("foreign_raw_ref").references(() => rawDocuments.id),
  ...provenance,
}, (t) => [
  primaryKey({ name: "daily_prices_pk", columns: [t.symbol, t.date] }),
  index("daily_prices_date").on(t.date),
  check("daily_prices_close_check", sql`${t.close} >= 0`),
]);

/** Session-window polls (§8.3). Served as DELAYED with `ts`, never LIVE; pruned after ENGINE_INTRADAY_RETENTION_DAYS. */
export const intradaySnapshots = pgTable("intraday_snapshots", {
  symbol: text("symbol").notNull(),
  ts: ts("ts").notNull(),
  last: price("last"),
  open: price("open"),
  high: price("high"),
  low: price("low"),
  change: price("change"),
  changePercent: fraction("change_percent"),
  volume: count("volume"),
  value: count("value"),
  frequency: count("frequency"),
  bestBid: price("best_bid"),
  bestOffer: price("best_offer"),
  ...provenance,
}, (t) => [
  primaryKey({ name: "intraday_snapshots_pk", columns: [t.symbol, t.ts, t.source] }),
  index("intraday_snapshots_symbol_ts").on(t.symbol, t.ts),
  index("intraday_snapshots_ts").on(t.ts),
]);

export const indexDaily = pgTable("index_daily", {
  code: text("code").notNull(),
  date: date("date").notNull(),
  open: price("open"),
  high: price("high"),
  low: price("low"),
  close: price("close").notNull(),
  previousClose: price("previous_close"),
  change: price("change"),
  changePercent: fraction("change_percent"),
  name: text("name"),
  ...provenance,
}, (t) => [primaryKey({ name: "index_daily_pk", columns: [t.code, t.date] })]);

/** Session-window index polls (IHSG, LQ45, IDX-IC sectors). DELAYED with `ts`, pruned like intraday_snapshots. */
export const indexIntraday = pgTable("index_intraday", {
  code: text("code").notNull(),
  ts: ts("ts").notNull(),
  name: text("name"),
  last: price("last").notNull(),
  open: price("open"),
  high: price("high"),
  low: price("low"),
  changePercent: fraction("change_percent"),
  ...provenance,
}, (t) => [
  primaryKey({ name: "index_intraday_pk", columns: [t.code, t.ts, t.source] }),
  index("index_intraday_ts").on(t.ts),
]);

/** Completeness of each session's EOD run: retried until every active symbol has a row, otherwise STALE. */
export const eodSessions = pgTable("eod_sessions", {
  date: date("date").primaryKey(),
  status: text("status", { enum: SESSION_STATUSES }).notNull().default("PENDING"),
  expected: integer("expected").notNull().default(0),
  present: integer("present").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  finalizedAt: ts("finalized_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const announcements = pgTable("announcements", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Stable id from the source (e.g. its announcement number), for idempotent upserts. */
  externalId: text("external_id").notNull(),
  symbol: text("symbol"),
  publishedAt: ts("published_at").notNull(),
  title: text("title").notNull(),
  category: text("category"),
  documentUrl: text("document_url"),
  ...provenance,
}, (t) => [
  unique("announcements_source_external").on(t.source, t.externalId),
  index("announcements_symbol_published").on(t.symbol, t.publishedAt),
]);

/**
 * News headlines (§2, §5.7): headline, canonical link, time, outlet, the feed's own short summary (≤ 280 chars, only
 * when the feed provides a description) and matched IDX symbols. Article bodies are never fetched or stored.
 * Deduplicated by `url` and by `title_key` within a few days; pruned after ENGINE_NEWS_RETENTION_DAYS.
 */
export const newsItems = pgTable("news_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  publishedAt: ts("published_at").notNull(),
  /** True when the feed gave no usable date and `published_at` is the fetch time. */
  publishedAtEstimated: boolean("published_at_estimated").notNull().default(false),
  title: text("title").notNull(),
  /** Normalized title (lower-case, no punctuation or accents) for cross-feed dedupe. */
  titleKey: text("title_key").notNull(),
  url: text("url").notNull().unique("news_items_url"),
  outlet: text("outlet").notNull(),
  summary: text("summary"),
  symbols: text("symbols").array().notNull().default(sql`'{}'::text[]`),
  ...provenance,
}, (t) => [
  index("news_items_published").on(t.publishedAt),
  index("news_items_title_key").on(t.titleKey, t.publishedAt),
  index("news_items_symbols").using("gin", t.symbols),
  check("news_items_summary_length", sql`${t.summary} is null or char_length(${t.summary}) <= 280`),
]);

/** Macro series from Bank Indonesia (§5.8): BI-Rate decisions (percent) and JISDOR (IDR per USD), one row per date. */
export const macroObservations = pgTable("macro_observations", {
  series: text("series").notNull(),
  date: date("date").notNull(),
  value: numeric("value", { precision: 18, scale: 6, mode: "number" }).notNull(),
  /** Supporting link from the source table (the BI-Rate press release), when it has one. */
  link: text("link"),
  ...provenance,
}, (t) => [primaryKey({ name: "macro_observations_pk", columns: [t.series, t.date] })]);

export const corporateActions = pgTable("corporate_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: text("symbol").notNull(),
  type: text("type").notNull(),
  exDate: date("ex_date"),
  recordDate: date("record_date"),
  paymentDate: date("payment_date"),
  /** Ratio as published (e.g. "1:5" for a split); amount per share for cash actions. */
  ratio: text("ratio"),
  amount: numeric("amount", { precision: 20, scale: 6, mode: "number" }),
  description: text("description"),
  ...provenance,
}, (t) => [
  unique("corporate_actions_natural").on(t.source, t.symbol, t.type, t.exDate),
  index("corporate_actions_symbol").on(t.symbol),
]);
