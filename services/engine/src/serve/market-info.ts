// Builds the E3 /v1 payloads (news, macro, the corporate-action calendar) from stored rows. Pure functions over a
// MarketStore; the HTTP layer validates every result with the shared Zod schemas before it leaves the engine.
//   News: newest first, served DELAYED while the newest headline is under a day old, STALE after (never LIVE).
//   Macro and actions: dated by their newest data and classified with the IDX session clock.
import type { z } from "zod";
import type { actionsCalendarSchema, macroSchema, newsItemSchema } from "@/server/schemas/idx-bei";
import { MACRO_SERIES, type MacroSeriesId } from "../sources/bi";
import { addDays, wibDateOf, wibIso, wibToday } from "../sources/session";
import { sessionFreshness, type Served } from "./market";
import type { MarketStore } from "./store";

export const NEWS_DEFAULT_PAGE_SIZE = 20;
export const NEWS_MAX_PAGE_SIZE = 100;
export const NEWS_MAX_PAGE = 500;
/** Observations per macro series in /v1/macro (the first BI table page holds 10). */
export const MACRO_OBSERVATIONS = 10;
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

// ── /v1/macro ───────────────────────────────────────────────────────────────────────────────────────────────────

export async function serveMacro(store: MarketStore, now: Date): Promise<Served<z.input<typeof macroSchema>> | null> {
  const rows = await store.macro(MACRO_OBSERVATIONS);
  if (!rows.length) return null;
  const series = (Object.keys(MACRO_SERIES) as MacroSeriesId[]).flatMap((id) => {
    const observations = rows.filter((row) => row.series === id).sort((a, b) => b.date.localeCompare(a.date));
    if (!observations.length) return [];
    const [latest, previous] = observations;
    return [{
      id, name: MACRO_SERIES[id].name, unit: MACRO_SERIES[id].unit, date: latest.date, value: latest.value,
      previousDate: previous?.date ?? null, previousValue: previous?.value ?? null, link: latest.link,
      observations: observations.map((row) => ({ date: row.date, value: row.value })),
    }];
  });
  if (!series.length) return null;
  const dataAsOf = series.map((row) => row.date).sort().at(-1)!;
  return { data: { series }, dataAsOf, freshness: sessionFreshness(dataAsOf, now) };
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
    data: rows.map((row) => ({ symbol: row.symbol, date: row.exDate, type: row.type, description: row.description, amount: row.amount, ratio: row.ratio, documentUrl: null })),
    dataAsOf, freshness: sessionFreshness(dataAsOf, now),
  };
}
