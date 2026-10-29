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
export type BlockEvidence = {
  reason: string; url: string; status: number | null; markers: string[]; headers: Record<string, string>; detectedAt: string;
  /** RATE_LIMITED only: n-th rate limit in a row (src/fetch/block.ts), and when the source may try again (null: never). */
  strike?: number; retryAt?: string | null;
};

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
  /** TradingView logo id (`bank-central-asia`), validated `^[a-z0-9-]{1,120}$`; served only with ENGINE_TICKER_LOGOS_ENABLED. */
  logoId: text("logo_id"),
  active: boolean("active").notNull().default(true),
  ...provenance,
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** IDX issuer detail snapshot by symbol/language; raw public disclosure arrays stay separate from KSEI ownership tables. */
export const idxIssuerProfiles = pgTable("idx_issuer_profiles", {
  symbol: text("symbol").notNull().references(() => securities.symbol),
  language: text("language").notNull(),
  profile: jsonb("profile").$type<Record<string, unknown>>().notNull(),
  directors: jsonb("directors").$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
  commissioners: jsonb("commissioners").$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
  auditCommittee: jsonb("audit_committee").$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
  shareholders: jsonb("shareholders").$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
  subsidiaries: jsonb("subsidiaries").$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
  retrievedAt: ts("retrieved_at").notNull(),
  ...provenance,
}, (t) => [primaryKey({ name: "idx_issuer_profiles_pk", columns: [t.symbol, t.language] })]);

/** Original IDX ratio values and fiscal metadata; percentage fields keep the source's percent units in metrics. */
export const idxRatioPeriods = pgTable("idx_ratio_periods", {
  // Keep the IDX source contract even when the local securities directory has not caught up yet.
  symbol: text("symbol").notNull(),
  fsDate: date("fs_date").notNull(),
  periodType: text("period_type").notNull(),
  fiscalYearEnd: text("fiscal_year_end"),
  sharia: text("sharia"),
  audit: text("audit"),
  opinion: text("opinion"),
  metrics: jsonb("metrics").$type<Record<string, number | null>>().notNull(),
  ...provenance,
}, (t) => [primaryKey({ name: "idx_ratio_periods_pk", columns: [t.symbol, t.fsDate, t.periodType] }), index("idx_ratio_periods_date").on(t.fsDate, t.symbol)]);

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

/** IDX GetBrokerSummary: one market-wide aggregate per exchange date and broker, never per stock. */
export const brokerDailySummaries = pgTable("broker_daily_summaries", {
  date: date("date").notNull(),
  brokerCode: text("broker_code").notNull(),
  firmName: text("firm_name"),
  volume: count("volume"),
  value: count("value"),
  frequency: count("frequency"),
  ...provenance,
}, (t) => [
  primaryKey({ name: "broker_daily_summaries_pk", columns: [t.date, t.brokerCode] }),
  index("broker_daily_summaries_code_date").on(t.brokerCode, t.date),
]);

/** IDX GetBrokerSearch registry, distinct from date×broker trading activity. */
export const idxBrokerMembers = pgTable("idx_broker_members", {
  brokerCode: text("broker_code").primaryKey(),
  firmName: text("firm_name").notNull(),
  license: text("license"),
  active: boolean("active").notNull().default(true),
  ...provenance,
});

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
  /** Exact IDX caType when the row came from GetIssuedHistory. */
  sourceCategory: text("source_category"),
  exDate: date("ex_date"),
  recordDate: date("record_date"),
  paymentDate: date("payment_date"),
  /** Ratio as published (e.g. "1:5" for a split); amount per share for cash actions. */
  ratio: text("ratio"),
  amount: numeric("amount", { precision: 20, scale: 6, mode: "number" }),
  shares: count("shares"),
  sharesAfter: count("shares_after"),
  description: text("description"),
  ...provenance,
}, (t) => [
  unique("corporate_actions_natural").on(t.source, t.symbol, t.type, t.exDate),
  index("corporate_actions_symbol").on(t.symbol),
]);

export const FINANCIAL_PERIOD_TYPES = ["annual", "quarterly"] as const;
export const FINANCIAL_UNITS = ["amount", "per_share", "shares"] as const;

/**
 * Financial statement lines (E5, §5.5), one row per (symbol, period end, period type, metric, source). Values are as
 * reported: `amount` in `currency` (the filing currency, IDR or USD), `per_share` in `currency` per share, `shares`
 * as a share count (currency null). Quarterly rows are discrete quarters; balance-sheet lines are period-end values.
 */
export const financials = pgTable("financials", {
  symbol: text("symbol").notNull(),
  periodEnd: date("period_end").notNull(),
  periodType: text("period_type", { enum: FINANCIAL_PERIOD_TYPES }).notNull(),
  metric: text("metric").notNull(),
  value: numeric("value", { precision: 30, scale: 6, mode: "number" }).notNull(),
  unit: text("unit", { enum: FINANCIAL_UNITS }).notNull(),
  currency: text("currency"),
  ...provenance,
}, (t) => [
  primaryKey({ name: "financials_pk", columns: [t.symbol, t.periodEnd, t.periodType, t.metric, t.source] }),
  index("financials_symbol_period").on(t.symbol, t.periodEnd),
  check("financials_period_type_check", sql`${t.periodType} in ('annual', 'quarterly')`),
  check("financials_unit_check", sql`${t.unit} in ('amount', 'per_share', 'shares')`),
]);

export const RATIO_KEYS = ["per", "pbv", "roe", "roa", "eps", "der", "dividendYield"] as const;
export const RATIO_SOURCES = ["derived", "idx", "pasardana"] as const;

/**
 * Valuation ratios per symbol: the latest value per (ratio, ratio_source). `derived` rows come from the `ratios` job
 * (financials + the latest close; formulas in src/derive/ratios.ts, version in `derivation`). `pasardana` rows are
 * Pasardana's own published ratios, kept as a secondary source. The screener prefers `derived` and falls back to
 * `pasardana` only when no derived row exists; it never blends the two, and reports which one it used.
 * `value` is null when the ratio is not meaningful (e.g. PER on non-positive earnings); `note` says why.
 * roe/roa/dividendYield are fractions (0.21 = 21%); eps is IDR per share; per/pbv/der are multiples.
 */
export const stockRatios = pgTable("stock_ratios", {
  symbol: text("symbol").notNull(),
  ratio: text("ratio", { enum: RATIO_KEYS }).notNull(),
  ratioSource: text("ratio_source", { enum: RATIO_SOURCES }).notNull(),
  value: numeric("value", { precision: 30, scale: 10, mode: "number" }),
  /** Session date of the price used (derived), or the source's data date (Pasardana `LastDate`). */
  date: date("date").notNull(),
  /** What the value rests on, e.g. `ttm-4q:2026-06-30`, `balance:2026-06-30`, `dividends-365d`, `pasardana:Per`. */
  basis: text("basis").notNull(),
  note: text("note"),
  inputs: jsonb("inputs").$type<Record<string, string | number | null>>().notNull().default(sql`'{}'::jsonb`),
  /** Derivation version of derived rows (e.g. `ratios-v1`); null for a source's own ratios. */
  derivation: text("derivation"),
  computedAt: ts("computed_at").notNull().defaultNow(),
  ...provenance,
}, (t) => [
  primaryKey({ name: "stock_ratios_pk", columns: [t.symbol, t.ratio, t.ratioSource] }),
  check("stock_ratios_ratio_source_check", sql`${t.ratioSource} in ('derived', 'idx', 'pasardana')`),
]);

// ── Ownership (E6, HAKA-66): the owner's monthly ≥1% list uploads → HAKA-33 snapshot sets, changes, HAKA-34 draft ──
// Fills the schema gap documented in CONNECTION-NETWORK.md ("Ownership snapshot type and change engine" → Schema gap):
// holder_key/holder_kind, structured provenance (dataset, reference, retrieved_at), threshold and issued shares per
// set, and no unique key that would reject a line the source really publishes twice (rows are unique per line locator).

export const OWNERSHIP_UPLOAD_STATUSES = ["RECEIVED", "PARSED", "FAILED"] as const;
export const OWNERSHIP_UPLOAD_FORMATS = ["pdf", "csv", "xlsx"] as const;
export const OWNERSHIP_HOLDER_KIND_VALUES = ["person", "organisation", "custodian_nominee", "government", "public", "unknown"] as const;
export const OWNERSHIP_CHANGE_KIND_VALUES = ["NEW", "INCREASE", "DECREASE", "EXIT", "UNCHANGED", "BELOW_THRESHOLD", "AMBIGUOUS"] as const;

/** Exact integer share counts and six-decimal percentages, kept as strings (HAKA-33 decimal.ts). */
const shareCount = (name: string) => numeric(name, { precision: 24, scale: 0 });
const signedShareCount = (name: string) => numeric(name, { precision: 25, scale: 0 });
const percent6 = (name: string) => numeric(name, { precision: 9, scale: 6 });
const ppDelta = (name: string) => numeric(name, { precision: 10, scale: 6 });

export type OwnershipUploadIssue = { severity: "error" | "warning"; locator: string; field?: string; message: string; text?: string };
export type OwnershipUploadStats = {
  parserVersion: string; records: number; rowsAccepted: number; rowsRejected: number; warnings: number; issuers: number;
  pages: number | null; columns: Array<{ label: string; field: string | null }>; setsReplaced: number; changes: number;
  issuesTruncated: boolean;
};

/** One uploaded file (raw copy in the raw store, deduplicated by sha256). */
export const ownershipUploads = pgTable("ownership_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  receivedAt: ts("received_at").notNull().defaultNow(),
  /** The month the owner says the list is for (YYYY-MM); the position date must fall in it. */
  asOfMonth: text("as_of_month").notNull(),
  /** Position date found in the file (or given as snapshotDate), once parsed. */
  snapshotDate: date("snapshot_date"),
  /** Position date override given with the upload (snapshotDate parameter), kept for re-parses. */
  snapshotDateOverride: date("snapshot_date_override"),
  /** The owner's label for where the file came from (e.g. the IDX announcement number). */
  sourceLabel: text("source_label"),
  fileName: text("file_name"),
  format: text("format", { enum: OWNERSHIP_UPLOAD_FORMATS }).notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: text("sha256").notNull().unique("ownership_uploads_sha256"),
  rawRef: uuid("raw_ref").notNull().references(() => rawDocuments.id),
  status: text("status", { enum: OWNERSHIP_UPLOAD_STATUSES }).notNull().default("RECEIVED"),
  /** File-level failure (no header, no position date, no valid row). */
  error: text("error"),
  /** Per-row validation errors and warnings (capped); rows with errors were not stored. */
  issues: jsonb("issues").$type<OwnershipUploadIssue[]>().notNull().default(sql`'[]'::jsonb`),
  stats: jsonb("stats").$type<OwnershipUploadStats>(),
  parsedAt: ts("parsed_at"),
}, (t) => [
  index("ownership_uploads_received").on(t.receivedAt),
  check("ownership_uploads_month_check", sql`${t.asOfMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
]);

/**
 * One issuer's snapshot for one month: the HAKA-33 OwnershipSnapshot header. A later upload of the same month
 * replaces the issuer's set (one set per symbol and month). `snapshot_date` is the set's as-of (position date).
 */
export const ownershipSnapshotSets = pgTable("ownership_snapshot_sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  uploadId: uuid("upload_id").notNull().references(() => ownershipUploads.id),
  symbol: text("symbol").notNull(),
  month: text("month").notNull(),
  snapshotDate: date("snapshot_date").notNull(),
  issuerName: text("issuer_name"),
  dataset: text("dataset").notNull(),
  thresholdPercent: percent6("threshold_percent").notNull(),
  issuedShares: shareCount("issued_shares"),
  /** Set-level provenance: the owner's label (or the upload id and file name). */
  sourceReference: text("source_reference").notNull(),
  retrievedAt: ts("retrieved_at").notNull(),
  rawRef: uuid("raw_ref").notNull().references(() => rawDocuments.id),
  rowCount: integer("row_count").notNull(),
  /** Comparison with the previous month (status, counts, issued-share change); null until derived. */
  comparison: jsonb("comparison").$type<Record<string, unknown>>(),
  /** HAKA-34 estimate (methodology DRAFT); served only with ENGINE_FREE_FLOAT_ENABLED=1. */
  freeFloat: jsonb("free_float").$type<Record<string, unknown>>(),
  derivedAt: ts("derived_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  unique("ownership_snapshot_sets_symbol_month").on(t.symbol, t.month),
  index("ownership_snapshot_sets_month").on(t.month),
  index("ownership_snapshot_sets_upload").on(t.uploadId),
]);

/** One disclosed holder line (HAKA-33 OwnershipSnapshotRow). Duplicate published lines are kept, unique by locator. */
export const ownershipSnapshotRows = pgTable("ownership_snapshot_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  setId: uuid("set_id").notNull().references(() => ownershipSnapshotSets.id, { onDelete: "cascade" }),
  /** Order in the file (1-based record number). */
  lineNo: integer("line_no").notNull(),
  holderKey: text("holder_key").notNull(),
  holderName: text("holder_name").notNull(),
  holderKind: text("holder_kind", { enum: OWNERSHIP_HOLDER_KIND_VALUES }).notNull(),
  shares: shareCount("shares"),
  percent: percent6("percent"),
  /** As stated by the source (e.g. KSEI "CP", "ID", "MF"); never guessed. */
  investorType: text("investor_type"),
  localForeign: text("local_foreign"),
  /** Line locator inside the uploaded file, e.g. "upload:<id>#p3.l12". */
  sourceReference: text("source_reference").notNull(),
}, (t) => [
  unique("ownership_snapshot_rows_set_reference").on(t.setId, t.sourceReference),
  index("ownership_snapshot_rows_set").on(t.setId, t.lineNo),
  index("ownership_snapshot_rows_holder").on(t.holderKey),
  check("ownership_snapshot_rows_kind_check", sql`${t.holderKind} in ('person', 'organisation', 'custodian_nominee', 'government', 'public', 'unknown')`),
  check("ownership_snapshot_rows_values_check", sql`${t.shares} is not null or ${t.percent} is not null`),
]);

/** Per-holder month-over-month changes (HAKA-33 compareOwnershipSnapshots), one row per holder key and target set. */
export const ownershipChanges = pgTable("ownership_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  toSetId: uuid("to_set_id").notNull().references(() => ownershipSnapshotSets.id, { onDelete: "cascade" }),
  fromSetId: uuid("from_set_id").notNull().references(() => ownershipSnapshotSets.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  /** Month of the later snapshot (YYYY-MM). */
  month: text("month").notNull(),
  fromDate: date("from_date").notNull(),
  toDate: date("to_date").notNull(),
  holderKey: text("holder_key").notNull(),
  holderName: text("holder_name").notNull(),
  holderKind: text("holder_kind", { enum: OWNERSHIP_HOLDER_KIND_VALUES }).notNull(),
  kind: text("kind", { enum: OWNERSHIP_CHANGE_KIND_VALUES }).notNull(),
  sharesBefore: shareCount("shares_before"),
  sharesAfter: shareCount("shares_after"),
  shareDelta: signedShareCount("share_delta"),
  percentBefore: percent6("percent_before"),
  percentAfter: percent6("percent_after"),
  ppDelta: ppDelta("pp_delta"),
  flags: text("flags").array().notNull().default(sql`'{}'::text[]`),
  /** Source references of the holder's lines in each month (the verbatim rows stay in ownership_snapshot_rows). */
  fromReferences: text("from_references").array().notNull().default(sql`'{}'::text[]`),
  toReferences: text("to_references").array().notNull().default(sql`'{}'::text[]`),
  /** Derivation version (DATA-ENGINE.md §6), e.g. "haka33-compare@1". */
  derivation: text("derivation").notNull(),
}, (t) => [
  unique("ownership_changes_to_set_holder").on(t.toSetId, t.holderKey),
  index("ownership_changes_month_symbol").on(t.month, t.symbol),
  index("ownership_changes_holder").on(t.holderKey),
]);

export const SCAN_RUN_STATUSES = ["SUCCEEDED", "SKIPPED"] as const;

/**
 * Strategy scans (E4, HAKA-64): one run per (session, rules version), replaced when re-run. Derived from daily_prices,
 * so there is no raw_ref; `rules_version` and `parameters` are the derivation version (§6) and `source` is the
 * HAKA-18 strategy source (HAKAPRO_EOD_ENGINE).
 */
export const scanRuns = pgTable("scan_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionDate: date("session_date").notNull(),
  rulesVersion: text("rules_version").notNull(),
  status: text("status", { enum: SCAN_RUN_STATUSES }).notNull(),
  /** Why the scan did not run (e.g. the EOD session was not COMPLETE). */
  skipReason: text("skip_reason"),
  /** The full rule parameters the run used. */
  parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull(),
  /** Securities scanned, passing gate G, failing it. */
  covered: integer("covered").notNull().default(0),
  eligible: integer("eligible").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  /** Gate failures by rule (G1…G8), and per strategy the first failing rule of each eligible symbol not listed. */
  gateFailures: jsonb("gate_failures").$type<Record<string, number>>().notNull().default({}),
  misses: jsonb("misses").$type<Record<string, Record<string, number>>>().notNull().default({}),
  candidateCount: integer("candidate_count").notNull().default(0),
  jobRunId: uuid("job_run_id").references(() => fetchRuns.id),
  source: text("source").notNull(),
  /** When the engine computed the run (`detectedAt` of its candidates). */
  asOf: ts("as_of").notNull(),
}, (t) => [
  unique("scan_runs_session_rules").on(t.sessionDate, t.rulesVersion),
  index("scan_runs_status_session").on(t.status, t.sessionDate),
]);

/** One stock listed by one strategy in one scan run, in the strategy's sort order (`rank`). */
export const scanCandidates = pgTable("scan_candidates", {
  runId: uuid("run_id").notNull().references(() => scanRuns.id, { onDelete: "cascade" }),
  strategyId: text("strategy_id").notNull(),
  symbol: text("symbol").notNull(),
  sessionDate: date("session_date").notNull(),
  rulesVersion: text("rules_version").notNull(),
  rank: integer("rank").notNull(),
  name: text("name"),
  /** HAKA-18 reasons (`criterion` keys and `note` texts) and metrics (`{key, value, unit}`). */
  reasons: jsonb("reasons").$type<Array<Record<string, unknown>>>().notNull(),
  metrics: jsonb("metrics").$type<Array<{ key: string; value: number | null; unit: string }>>().notNull(),
  source: text("source").notNull(),
  asOf: ts("as_of").notNull(),
}, (t) => [
  primaryKey({ name: "scan_candidates_pk", columns: [t.runId, t.strategyId, t.symbol] }),
  index("scan_candidates_session_strategy").on(t.sessionDate, t.strategyId),
]);

export const INSIDER_ACTIONS = ["BUY", "SELL", "CROSS", "OTHER"] as const;
/** Percent units as arjum publishes them (0.0061 = 0.0061%, 17.62 = 17.62%), not fractions. */
const percentUnits = (name: string) => numeric(name, { precision: 12, scale: 6, mode: "number" });

/**
 * Insider transactions (arjum `/api/insiders/{code}` page 1, the `insider-feed` job). One row per reported transaction;
 * a re-fetch of the same page updates the row in place (natural key below, NULLs compared as equal) instead of adding one.
 */
export const insiderTransactions = pgTable("insider_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: text("symbol").notNull(),
  person: text("person").notNull(),
  /** Role badges as published (e.g. KOMISARIS, DIREKTUR); empty when none. */
  roles: jsonb("roles").$type<string[]>().notNull().default([]),
  action: text("action", { enum: INSIDER_ACTIONS }).notNull(),
  date: date("date").notNull(),
  /** Signed share change (+ bought, − sold); shares before/after and percents only when the source gives them. */
  sharesChange: count("shares_change"),
  sharesBefore: count("shares_before"),
  sharesAfter: count("shares_after"),
  percentBefore: percentUnits("percent_before"),
  percentAfter: percentUnits("percent_after"),
  percentChange: percentUnits("percent_change"),
  /** Transaction price in IDR; null when the source reports none (it publishes "0" for those). */
  price: price("price"),
  broker: text("broker"),
  nationality: text("nationality"),
  ...provenance,
  firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
}, (t) => [
  unique("insider_transactions_natural").on(t.symbol, t.date, t.person, t.action, t.sharesChange, t.sharesAfter).nullsNotDistinct(),
  index("insider_transactions_date").on(t.date),
]);

/**
 * When the `insider-feed` job last read each symbol's newest insider page: the job's rotation (oldest check first) and
 * the coverage `/v1/insiders/recent` states. An unknown code (404) is recorded too, with no raw document.
 */
export const insiderChecks = pgTable("insider_checks", {
  symbol: text("symbol").primaryKey(),
  /** WIB calendar date of the check. */
  checkedDate: date("checked_date").notNull(),
  /** Transactions on the page read (at most 15), and the provider's total for the symbol (null for an unknown code). */
  rows: integer("rows").notNull().default(0),
  total: integer("total"),
  ...provenance,
}, (t) => [index("insider_checks_checked_date").on(t.checkedDate)]);
