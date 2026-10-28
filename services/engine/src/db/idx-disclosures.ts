// Idempotent IDX disclosure writes use the existing corporate_actions, news_items, and announcements tables.
import { sql } from "drizzle-orm";
import * as t from "../../db/schema";
import type { IdxAnnouncementRow } from "../sources/idx-disclosures";
import type { EngineDb } from "./client";
import type { Provenance } from "./ingest";
import { upsertCorporateActions, type ActionUpsert } from "./ingest";
import type { NewsItemParsed } from "../sources/news";
import { insertNews } from "./market-info";

export async function upsertIdxActions(db: EngineDb, rows: ActionUpsert[], provenance: Provenance): Promise<number> {
  return upsertCorporateActions(db, rows, provenance);
}

export async function upsertIdxAnnouncements(db: EngineDb, rows: IdxAnnouncementRow[], provenance: Provenance): Promise<number> {
  if (!rows.length) return 0;
  const result = await db.insert(t.announcements).values(rows.map((row) => ({
    externalId: row.externalId, symbol: row.symbol, publishedAt: row.publishedAt, title: row.title,
    category: row.category, documentUrl: row.documentUrl, source: provenance.source, asOf: provenance.asOf, rawRef: provenance.rawRef,
  }))).onConflictDoUpdate({
    target: [t.announcements.source, t.announcements.externalId],
    set: { symbol: sql`excluded."symbol"`, publishedAt: sql`excluded."published_at"`, title: sql`excluded."title"`, category: sql`excluded."category"`, documentUrl: sql`excluded."document_url"`, asOf: sql`excluded."as_of"`, rawRef: sql`excluded."raw_ref"` },
  }).returning({ externalId: t.announcements.externalId });
  return result.length;
}

/** IDX news shares the same canonical URL/title dedupe implementation as the existing RSS ingestion. */
export async function insertIdxNews(db: EngineDb, items: NewsItemParsed[], provenance: Provenance): Promise<number> {
  return insertNews(db, items, provenance);
}
