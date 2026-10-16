// Idempotent writes for the E3 sources: news headlines and BI macro series. Every row carries `source`, `as_of` and
// `raw_ref`. News is deduplicated by canonical URL (unique) and by normalized title within TITLE_DEDUPE_DAYS.
import { and, gte, inArray, lt, lte, sql } from "drizzle-orm";
import * as t from "../../db/schema";
import type { MacroRow } from "../sources/bi";
import type { NewsItemParsed } from "../sources/news";
import type { EngineDb } from "./client";
import type { Provenance } from "./ingest";

/** The same normalized headline within this many days (any outlet) is one story. */
export const TITLE_DEDUPE_DAYS = 3;
const DAY_MS = 86_400_000;

/** Every symbol the engine knows (active or not): the allow-list for headline symbol matching. */
export async function knownSymbols(db: EngineDb): Promise<Set<string>> {
  const rows = await db.select({ symbol: t.securities.symbol }).from(t.securities);
  return new Set(rows.map((row) => row.symbol));
}

/**
 * Inserts new headlines; returns how many rows were added. An item is skipped when its URL is already stored, or when
 * the same title key was stored within TITLE_DEDUPE_DAYS of its publication time (syndicated or re-posted story).
 */
export async function insertNews(db: EngineDb, items: NewsItemParsed[], prov: Provenance): Promise<number> {
  if (!items.length) return 0;
  const times = items.map((item) => item.publishedAt.getTime());
  const window = { from: new Date(Math.min(...times) - TITLE_DEDUPE_DAYS * DAY_MS), to: new Date(Math.max(...times) + TITLE_DEDUPE_DAYS * DAY_MS) };
  const existing = await db.select({ titleKey: t.newsItems.titleKey, publishedAt: t.newsItems.publishedAt }).from(t.newsItems)
    .where(and(inArray(t.newsItems.titleKey, [...new Set(items.map((item) => item.titleKey))]), gte(t.newsItems.publishedAt, window.from), lte(t.newsItems.publishedAt, window.to)));
  const fresh = items.filter((item) => !existing.some((row) => row.titleKey === item.titleKey && Math.abs(row.publishedAt.getTime() - item.publishedAt.getTime()) <= TITLE_DEDUPE_DAYS * DAY_MS));
  if (!fresh.length) return 0;
  const inserted = await db.insert(t.newsItems).values(fresh.map((item) => ({
    publishedAt: item.publishedAt, publishedAtEstimated: item.publishedAtEstimated, title: item.title, titleKey: item.titleKey,
    url: item.url, outlet: item.outlet, summary: item.summary, symbols: item.symbols,
    source: prov.source, asOf: prov.asOf, rawRef: prov.rawRef,
  }))).onConflictDoNothing({ target: t.newsItems.url }).returning({ id: t.newsItems.id });
  return inserted.length;
}

/** Deletes up to `limit` headlines published before `cutoff`; returns the count. */
export async function deleteNewsOlderThan(db: EngineDb, cutoff: Date, limit: number): Promise<number> {
  const victims = db.select({ id: t.newsItems.id }).from(t.newsItems).where(lt(t.newsItems.publishedAt, cutoff)).limit(limit);
  const deleted = await db.delete(t.newsItems).where(sql`${t.newsItems.id} in (${victims})`).returning({ id: t.newsItems.id });
  return deleted.length;
}

/** Upserts BI rows; a later read of the same date replaces the value (BI corrections) and its provenance. */
export async function upsertMacro(db: EngineDb, rows: MacroRow[], prov: Provenance): Promise<number> {
  if (!rows.length) return 0;
  await db.insert(t.macroObservations).values(rows.map((row) => ({
    series: row.series, date: row.date, value: row.value, link: row.link, source: prov.source, asOf: prov.asOf, rawRef: prov.rawRef,
  }))).onConflictDoUpdate({
    target: [t.macroObservations.series, t.macroObservations.date],
    set: { value: sql`excluded."value"`, link: sql`coalesce(excluded."link", ${t.macroObservations.link})`, source: sql`excluded."source"`, asOf: sql`excluded."as_of"`, rawRef: sql`excluded."raw_ref"` },
  });
  return rows.length;
}
