// Builds the E3 /v1 payloads (news, macro, the corporate-action calendar) from stored rows. Pure functions over a
// MarketStore; the HTTP layer validates every result with the shared Zod schemas before it leaves the engine.
//   News: newest first, served DELAYED while the newest headline is under a day old, STALE after (never LIVE).
//   Macro and actions: dated by their newest data and classified with the IDX session clock.
import type { z } from "zod";
import type { actionsCalendarSchema, indicesHistorySchema, macroSchema, newsItemSchema, marketBrokerSummarySchema, profileSchema, announcementItemSchema, brokerDirectorySchema } from "@/server/schemas/idx-bei";
import { MACRO_SERIES } from "../sources/bi";
import { WORLD_BANK_COMMODITIES } from "../sources/worldbank";
import { addDays, wibDateOf, wibIso, wibToday } from "../sources/session";
import { indexCoverageReport } from "./index-quality";
import { sessionFreshness, type Served } from "./market";
import type { MarketStore } from "./store";

export const NEWS_DEFAULT_PAGE_SIZE = 20;
export const NEWS_MAX_PAGE_SIZE = 100;
export const NEWS_MAX_PAGE = 500;
/** Observations per macro series in /v1/macro (BI: first table page = 10 rows; commodities: 10 months). */
export const MACRO_OBSERVATIONS = 10;
export const BROKER_SUMMARY_DEFAULT_LIMIT = 20;

/** Display metadata for every macro series, in served order: Bank Indonesia first, then World Bank commodities. */
export const MACRO_SERIES_META: { id: string; name: string; unit: string }[] = [
  ...Object.entries(MACRO_SERIES).map(([id, meta]) => ({ id, name: meta.name, unit: meta.unit })),
  ...Object.entries(WORLD_BANK_COMMODITIES).map(([id, meta]) => ({ id, name: meta.name, unit: meta.unit })),
];
export const ACTIONS_LOOKBACK_DAYS = 30;
export const ACTIONS_LOOKAHEAD_DAYS = 60;
export const ACTIONS_MAX_RANGE_DAYS = 366;
const NEWS_FRESH_MS = 24 * 3_600_000;

// ── /v1/news ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function serveNews(store: MarketStore, query: { page: number; pageSize: number; symbol?: string }, now: Date): Promise<Served<z.input<typeof newsItemSchema>[]> | null> {
  const latest = await store.latestNewsAt();
  if (!latest) return null;
  const rows = await store.news({ offset: (query.page - 1) * query.pageSize, limit: query.pageSize, symbol: query.symbol });
  return {
    data: rows.map((row) => ({
      date: wibIso(row.publishedAt), title: row.title, summary: row.summary, url: row.url,
      outlet: row.outlet, symbols: row.symbols, dateEstimated: row.publishedAtEstimated,
    })),
    dataAsOf: wibIso(latest),
    freshness: now.getTime() - latest.getTime() <= NEWS_FRESH_MS ? "DELAYED" : "STALE",
  };
}

export async function serveAnnouncements(store: MarketStore, query: { page: number; pageSize: number; symbol?: string }, now: Date): Promise<Served<z.input<typeof announcementItemSchema>[]> | null> {
  const latest = await store.latestAnnouncementAt();
  if (!latest) return null;
  const rows = await store.announcements({ offset: (query.page - 1) * query.pageSize, limit: query.pageSize, symbol: query.symbol });
  return {
    data: rows.map((row) => ({ date: wibIso(row.publishedAt), symbol: row.symbol, title: row.title, documentUrl: row.documentUrl })),
    dataAsOf: wibIso(latest), freshness: now.getTime() - latest.getTime() <= NEWS_FRESH_MS ? "DELAYED" : "STALE",
  };
}

// ── /v1/macro ───────────────────────────────────────────────────────────────────────────────────────────────────

export async function serveMacro(store: MarketStore, now: Date): Promise<Served<z.input<typeof macroSchema>> | null> {
  const rows = await store.macro(MACRO_OBSERVATIONS);
  if (!rows.length) return null;
  const series = MACRO_SERIES_META.flatMap((meta) => {
    const observations = rows.filter((row) => row.series === meta.id).sort((a, b) => b.date.localeCompare(a.date));
    if (!observations.length) return [];
    const [latest, previous] = observations;
    return [{
      id: meta.id, name: meta.name, unit: meta.unit, date: latest.date, value: latest.value,
      previousDate: previous?.date ?? null, previousValue: previous?.value ?? null, link: latest.link,
      observations: observations.map((row) => ({ date: row.date, value: row.value })),
    }];
  });
  if (!series.length) return null;
  const dataAsOf = series.map((row) => row.date).sort().at(-1)!;
  return { data: { series }, dataAsOf, freshness: sessionFreshness(dataAsOf, now) };
}

// ── /v1/indices/history ─────────────────────────────────────────────────────────────────────────────────────────

/** Daily close series per index code (oldest first), grouped by code. Null when nothing is stored in range. */
export async function serveIndicesHistory(store: MarketStore, from: string, to: string, codes: string[] | null, now: Date): Promise<Served<z.input<typeof indicesHistorySchema>> | null> {
  const rows = await store.indexDailyBetween(codes, from, to);
  if (!rows.length) return null;
  const byCode = new Map<string, { code: string; name: string | null; points: { date: string; close: number }[] }>();
  for (const row of rows) {
    let series = byCode.get(row.code);
    if (!series) { series = { code: row.code, name: row.name, points: [] }; byCode.set(row.code, series); }
    series.points.push({ date: row.date, close: row.close });
  }
  const dataAsOf = rows.map((row) => row.date).sort().at(-1)!;
  const series = [...byCode.values()];
  return { data: { series, coverage: indexCoverageReport(series, wibToday(now)) }, dataAsOf, freshness: sessionFreshness(dataAsOf, now) };
}

/** Market-wide date×broker totals, ranked by traded value independently for each date. */
export async function serveMarketBrokerSummary(store: MarketStore, from: string, to: string, limit: number, now: Date): Promise<Served<z.input<typeof marketBrokerSummarySchema>> | null> {
  const [latest, rows] = await Promise.all([store.latestBrokerSummaryDate(), store.brokerDailySummaryBetween(from, to)]);
  if (!latest) return null;
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) grouped.set(row.date, [...(grouped.get(row.date) ?? []), row]);
  const dates = [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([date, entries]) => ({
    date,
    brokers: entries.sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.brokerCode.localeCompare(b.brokerCode)).slice(0, limit)
      .map((row) => ({ code: row.brokerCode, name: row.firmName, volume: row.volume, value: row.value, frequency: row.frequency })),
  }));
  return { data: { dates }, dataAsOf: latest, freshness: sessionFreshness(latest, now) };
}

export async function serveBrokerDirectory(store: MarketStore, now: Date): Promise<Served<z.input<typeof brokerDirectorySchema>> | null> {
  const [latest, rows] = await Promise.all([store.latestBrokerDirectoryAsOf(), store.brokerDirectory()]);
  if (!latest || !rows.length) return null;
  const dataAsOf = wibIso(latest);
  return { data: { brokers: rows.map(({ code, name, license }) => ({ code, name, license })) }, dataAsOf, freshness: sessionFreshness(wibDateOf(latest), now) };
}

export async function serveIssuerProfile(store: MarketStore, symbol: string): Promise<Served<z.input<typeof profileSchema>> | null> {
  const row = await store.issuerProfile(symbol);
  if (!row) return null;
  const profile = row.profile;
  return {
    data: {
      symbol: row.symbol, companyName: typeof profile.NamaEmiten === "string" ? profile.NamaEmiten : null,
      website: typeof profile.Website === "string" ? profile.Website : null,
      description: typeof profile.KegiatanUsahaUtama === "string" ? profile.KegiatanUsahaUtama : null,
      directors: row.directors, commissioners: row.commissioners, shareholders: row.shareholders, subsidiaries: row.subsidiaries,
    },
    dataAsOf: null, freshness: "HISTORICAL",
  };
}

// ── /v1/actions ─────────────────────────────────────────────────────────────────────────────────────────────────

export type ActionsRange = { from: string; to: string };

/** Default calendar window: the last 30 days and the next 60 (WIB dates). */
export function defaultActionsRange(now: Date): ActionsRange {
  const today = wibToday(now);
  return { from: addDays(today, -ACTIONS_LOOKBACK_DAYS), to: addDays(today, ACTIONS_LOOKAHEAD_DAYS) };
}

export async function serveActionsCalendar(store: MarketStore, range: ActionsRange, now: Date): Promise<Served<z.input<typeof actionsCalendarSchema>> | null> {
  const asOf = await store.latestActionAsOf();
  if (!asOf) return null;
  const rows = await store.actionsBetween(range.from, range.to);
  const dataAsOf = wibDateOf(asOf);
  return {
    data: rows.map((row) => ({ symbol: row.symbol, date: row.exDate, type: row.type, sourceCategory: row.sourceCategory ?? null, description: row.description, amount: row.amount, ratio: row.ratio, shares: row.shares, sharesAfter: row.sharesAfter, documentUrl: null })),
    dataAsOf, freshness: sessionFreshness(dataAsOf, now),
  };
}
