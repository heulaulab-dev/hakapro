// Engine database (DATA-ENGINE.md §6). Separate from the app database: own PostgreSQL, own migrations.
// Every data table carries `source`, `as_of` and `raw_ref` (the raw document it was parsed from).
import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, unique, uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const price = (name: string) => numeric(name, { precision: 18, scale: 4, mode: "number" });
const count = (name: string) => bigint(name, { mode: "number" });

export const SOURCE_STATUSES = ["NEVER_RUN", "OK", "ERROR", "BLOCKED"] as const;
export const PARSE_STATUSES = ["PENDING", "PARSED", "FAILED", "SKIPPED"] as const;
export const RUN_STATUSES = ["RUNNING", "SUCCEEDED", "FAILED", "BLOCKED", "YIELDED"] as const;

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
  sharesOutstanding: count("shares_outstanding"),
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
  change: price("change"),
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
  ...provenance,
}, (t) => [primaryKey({ name: "index_daily_pk", columns: [t.code, t.date] })]);

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

/** Headline + link only (§2: news is never stored in full). */
export const newsItems = pgTable("news_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  publishedAt: ts("published_at").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull().unique("news_items_url"),
  outlet: text("outlet").notNull(),
  symbols: text("symbols").array().notNull().default(sql`'{}'::text[]`),
  ...provenance,
}, (t) => [index("news_items_published").on(t.publishedAt)]);

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
