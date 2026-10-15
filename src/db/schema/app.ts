import { sql } from "drizzle-orm";
import {
  boolean, check, date, index, integer, jsonb, numeric, pgTable,
  text, timestamp, unique, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

const jsonObject = (name: string) => jsonb(name).$type<Record<string, unknown>>();

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  timezone: text("timezone").notNull().default("Asia/Jakarta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const watchlists = pgTable("watchlists", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("watchlists_name_check", sql`length(trim(${t.name})) between 1 and 80`),
  check("watchlists_position_check", sql`${t.position} >= 0`),
  uniqueIndex("watchlists_one_default").on(t.userId).where(sql`${t.isDefault}`),
  index("watchlists_user_position").on(t.userId, t.position),
]);

export const watchlistItems = pgTable("watchlist_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  watchlistId: uuid("watchlist_id").notNull().references(() => watchlists.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("watchlist_items_symbol_check", sql`${t.symbol} ~ '^[A-Z0-9]{1,12}$'`),
  check("watchlist_items_position_check", sql`${t.position} >= 0`),
  unique("watchlist_items_watchlist_id_symbol_unique").on(t.watchlistId, t.symbol),
  index("watchlist_items_list_position").on(t.watchlistId, t.position),
]);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  layout: jsonObject("layout").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("workspaces_name_check", sql`length(trim(${t.name})) between 1 and 80`),
  check("workspaces_layout_check", sql`jsonb_typeof(${t.layout}) = 'object'`),
  uniqueIndex("workspaces_one_default").on(t.userId).where(sql`${t.isDefault}`),
  uniqueIndex("workspaces_user_name").on(t.userId, t.name),
  index("workspaces_user").on(t.userId),
]);

export const workspacePanels = pgTable("workspace_panels", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  panelType: text("panel_type").notNull(),
  symbol: text("symbol"),
  isLocked: boolean("is_locked").notNull().default(false),
  position: integer("position").notNull().default(0),
  settings: jsonObject("settings").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("workspace_panels_panel_type_check", sql`${t.panelType} in ('MARKET','WL','CHART','BROKER','FOREIGN','FUND','PROFILE','OWNERSHIP','CORP','SCREENER','NEWS','ANN','PORT','ALERTS','SIGNALS')`),
  check("workspace_panels_symbol_check", sql`${t.symbol} is null or ${t.symbol} ~ '^[A-Z0-9]{1,12}$'`),
  check("workspace_panels_position_check", sql`${t.position} >= 0`),
  check("workspace_panels_settings_check", sql`jsonb_typeof(${t.settings}) = 'object'`),
  index("workspace_panels_workspace_position").on(t.workspaceId, t.position),
]);

export const portfolios = pgTable("portfolios", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("IDR"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("portfolios_name_check", sql`length(trim(${t.name})) between 1 and 80`),
  check("portfolios_currency_check", sql`${t.currency} = 'IDR'`),
  index("portfolios_user").on(t.userId),
]);

export const portfolioTransactions = pgTable("portfolio_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  portfolioId: uuid("portfolio_id").notNull().references(() => portfolios.id, { onDelete: "cascade" }),
  symbol: text("symbol"),
  transactionType: text("transaction_type").notNull(),
  transactionDate: date("transaction_date", { mode: "string" }).notNull(),
  quantity: numeric("quantity", { precision: 24, scale: 6 }),
  price: numeric("price", { precision: 24, scale: 6 }),
  fees: numeric("fees", { precision: 24, scale: 6 }).notNull().default("0"),
  cashAmount: numeric("cash_amount", { precision: 24, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("portfolio_transactions_symbol_check", sql`${t.symbol} is null or ${t.symbol} ~ '^[A-Z0-9]{1,12}$'`),
  check("portfolio_transactions_type_check", sql`${t.transactionType} in ('BUY','SELL','DIVIDEND','CASH_ADJUSTMENT')`),
  check("portfolio_transactions_fees_check", sql`${t.fees} >= 0`),
  check("portfolio_transactions_shape_check", sql`(
    (${t.transactionType} in ('BUY','SELL') and ${t.symbol} is not null and ${t.quantity} > 0 and ${t.price} >= 0 and ${t.cashAmount} is null)
    or (${t.transactionType} = 'DIVIDEND' and ${t.symbol} is not null and ${t.cashAmount} >= 0 and ${t.quantity} is null and ${t.price} is null)
    or (${t.transactionType} = 'CASH_ADJUSTMENT' and ${t.symbol} is null and ${t.cashAmount} is not null and ${t.quantity} is null and ${t.price} is null)
  )`),
  index("portfolio_transactions_order").on(t.portfolioId, t.transactionDate, t.createdAt),
]);

export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  metric: text("metric").notNull(),
  operator: text("operator").notNull(),
  threshold: numeric("threshold", { precision: 24, scale: 6 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("alerts_symbol_check", sql`${t.symbol} ~ '^[A-Z0-9]{1,12}$'`),
  check("alerts_metric_check", sql`${t.metric} in ('PRICE','DAILY_CHANGE','FOREIGN_NET','VOLUME','VOLUME_RATIO_20D')`),
  check("alerts_operator_check", sql`${t.operator} in ('GT','GTE','LT','LTE')`),
  index("alerts_user_enabled").on(t.userId, t.enabled),
]);

export const alertEvents = pgTable("alert_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  alertId: uuid("alert_id").notNull().references(() => alerts.id, { onDelete: "cascade" }),
  observedValue: numeric("observed_value", { precision: 24, scale: 6 }).notNull(),
  observedAsOf: date("observed_as_of", { mode: "string" }).notNull(),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
}, (t) => [
  unique("alert_events_alert_id_observed_as_of_unique").on(t.alertId, t.observedAsOf),
  index("alert_events_alert_time").on(t.alertId, t.triggeredAt.desc()),
]);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("notifications_type_check", sql`${t.type} in ('PRICE_ALERT','FOREIGN_FLOW_ALERT','VOLUME_ALERT','SYSTEM')`),
  index("notifications_user_unread").on(t.userId, t.createdAt.desc()).where(sql`${t.readAt} is null`),
]);

export const savedScreeners = pgTable("saved_screeners", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  conditions: jsonb("conditions").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  sortConfig: jsonObject("sort_config").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("saved_screeners_name_check", sql`length(trim(${t.name})) between 1 and 80`),
  check("saved_screeners_conditions_check", sql`jsonb_typeof(${t.conditions}) = 'array'`),
  check("saved_screeners_sort_config_check", sql`jsonb_typeof(${t.sortConfig}) = 'object'`),
  index("saved_screeners_user").on(t.userId),
]);

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("notes_symbol_check", sql`${t.symbol} is null or ${t.symbol} ~ '^[A-Z0-9]{1,12}$'`),
  index("notes_user_symbol").on(t.userId, t.symbol),
]);

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  density: text("density").notNull().default("COMPACT"),
  columns: jsonObject("columns").notNull().default(sql`'{}'::jsonb`),
  shortcuts: jsonObject("shortcuts").notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("user_preferences_density_check", sql`${t.density} in ('COMPACT','COMFORTABLE')`),
  check("user_preferences_columns_check", sql`jsonb_typeof(${t.columns}) = 'object'`),
  check("user_preferences_shortcuts_check", sql`jsonb_typeof(${t.shortcuts}) = 'object'`),
]);

export const securities = pgTable("securities", {
  symbol: text("symbol").primaryKey(),
  companyName: text("company_name").notNull(),
  exchange: text("exchange").notNull().default("IDX"),
  board: text("board"),
  sector: text("sector"),
  subsector: text("subsector"),
  listingDate: date("listing_date", { mode: "string" }),
  status: text("status").notNull().default("ACTIVE"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("securities_symbol_check", sql`${t.symbol} ~ '^[A-Z0-9]{1,12}$'`),
  index("securities_company_name").using("gin", sql`to_tsvector('simple', ${t.companyName})`),
]);

export const companies = pgTable("companies", {
  symbol: text("symbol").primaryKey().references(() => securities.symbol, { onDelete: "cascade" }),
  website: text("website"),
  description: text("description"),
  directors: jsonb("directors"),
  commissioners: jsonb("commissioners"),
  subsidiaries: jsonb("subsidiaries"),
  source: text("source").notNull(),
  dataAsOf: date("data_as_of", { mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const companyFundamentals = pgTable("company_fundamentals", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: text("symbol").notNull().references(() => securities.symbol, { onDelete: "cascade" }),
  periodDate: date("period_date", { mode: "string" }).notNull(),
  periodType: text("period_type").notNull(),
  metrics: jsonObject("metrics").notNull(),
  source: text("source").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("company_fundamentals_period_type_check", sql`${t.periodType} in ('ANNUAL','QUARTERLY')`),
  check("company_fundamentals_metrics_check", sql`jsonb_typeof(${t.metrics}) = 'object'`),
  unique("company_fundamentals_symbol_period_date_period_type_unique").on(t.symbol, t.periodDate, t.periodType),
  index("company_fundamentals_symbol_period").on(t.symbol, t.periodDate.desc()),
]);

export const corporateActions = pgTable("corporate_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: text("symbol").notNull().references(() => securities.symbol, { onDelete: "cascade" }),
  eventDate: date("event_date", { mode: "string" }).notNull(),
  actionType: text("action_type").notNull(),
  description: text("description"),
  documentUrl: text("document_url"),
  source: text("source").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("corporate_actions_symbol_date").on(t.symbol, t.eventDate.desc())]);

export const ownershipSnapshots = pgTable("ownership_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: text("symbol").notNull().references(() => securities.symbol, { onDelete: "cascade" }),
  snapshotDate: date("snapshot_date", { mode: "string" }).notNull(),
  holderName: text("holder_name").notNull(),
  shares: numeric("shares", { precision: 24, scale: 0 }),
  percentage: numeric("percentage", { precision: 9, scale: 6 }),
  source: text("source").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("ownership_snapshots_percentage_check", sql`${t.percentage} is null or ${t.percentage} between 0 and 100`),
  unique("ownership_snapshots_symbol_snapshot_date_holder_name_unique").on(t.symbol, t.snapshotDate, t.holderName),
  index("ownership_snapshots_symbol_date").on(t.symbol, t.snapshotDate.desc()),
]);

export const marketIndices = pgTable("market_indices", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  source: text("source").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const marketSnapshots = pgTable("market_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().references(() => marketIndices.code),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  close: numeric("close", { precision: 24, scale: 6 }),
  changePercent: numeric("change_percent", { precision: 12, scale: 8 }),
  volume: numeric("volume", { precision: 24, scale: 0 }),
  value: numeric("value", { precision: 24, scale: 2 }),
  source: text("source").notNull(),
}, (t) => [
  unique("market_snapshots_code_as_of_unique").on(t.code, t.asOf),
  index("market_snapshots_code_asof").on(t.code, t.asOf.desc()),
]);
