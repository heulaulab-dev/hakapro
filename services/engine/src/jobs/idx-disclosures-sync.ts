// Frequent bounded refresh for current IDX headlines, disclosures, and recent corporate actions.
import { addDays, wibToday } from "../sources/session";
import type { EngineDb } from "../db/client";
import type { Provenance } from "../db/ingest";
import type { NewsItemParsed } from "../sources/news";
import type { IdxAnnouncementRow, IdxActionRow } from "../sources/idx-disclosures";
import { idxAnnouncementPageInfo, idxNewsPageInfo, parseIdxActions, parseIdxAnnouncements, parseIdxNews, fetchIdxActions, fetchIdxAnnouncements, fetchIdxNews, IDX_CA_TYPES } from "../sources/idx-disclosures";
import type { IdxJsonTransport } from "../sources/idx-primary";
import { knownSymbols } from "../db/market-info";
import { insertIdxNews, upsertIdxActions, upsertIdxAnnouncements } from "../db/idx-disclosures";
import type { JobDefinition } from "../schedule/scheduler";
import type { JobServices, SourceRef } from "./common";

export const IDX_DISCLOSURES_SYNC_ID = "idx-disclosures-sync";
const PAGE_SIZE = 100;
const MAX_NEWS_PAGES = 1000;
const MAX_ANNOUNCEMENT_PAGES = 1000;
const ACTION_PAGE_SIZE = 9999;

export function idxDisclosuresSyncJob(
  services: JobServices,
  source: SourceRef,
  transport: IdxJsonTransport,
  hooks: {
    categories?: readonly string[];
    knownSymbols?: (db: EngineDb) => Promise<Set<string>>;
    persistNews?: (db: EngineDb, rows: NewsItemParsed[], provenance: Provenance) => Promise<number>;
    persistAnnouncements?: (db: EngineDb, rows: IdxAnnouncementRow[], provenance: Provenance) => Promise<number>;
    persistActions?: (db: EngineDb, rows: IdxActionRow[], provenance: Provenance) => Promise<number>;
  } = {},
): JobDefinition {
  return {
    id: IDX_DISCLOSURES_SYNC_ID, sourceId: source.id,
    trigger: { kind: "cron", spec: "0 7,11,15,19 * * 1-5", tradingDaysOnly: true },
    async run(ctx) {
      const today = wibToday(services.now());
      const fromDate = addDays(today, -30);
      const from = fromDate.replace(/-/g, "");
      const to = today.replace(/-/g, "");
      const known = await (hooks.knownSymbols ?? knownSymbols)(services.db);
      let stored = 0;

      let newsTotal: number | null = null;
      const newsPageSignatures = new Set<string>();
      let newsPage = 1;
      while (newsPage <= MAX_NEWS_PAGES) {
        if (ctx.shouldYield()) return { status: "YIELDED" };
        const fetched = await fetchIdxNews(transport, newsPage);
        if (!fetched.ok) throw new Error(`IDX news page ${newsPage} unavailable: ${fetched.reason}`);
        const info = idxNewsPageInfo(fetched.body);
        const signature = JSON.stringify(fetched.body);
        if (newsPageSignatures.has(signature)) throw new Error(`IDX news repeated page ${newsPage}`);
        newsPageSignatures.add(signature);
        const items = parseIdxNews(fetched.body, services.now(), known);
        stored += await (hooks.persistNews ?? insertIdxNews)(services.db, items, { source: source.id, asOf: services.now(), rawRef: null });
        newsTotal = info.total ?? newsTotal;
        if (info.rows < PAGE_SIZE || (newsTotal !== null && newsPage * PAGE_SIZE >= newsTotal)) break;
        newsPage += 1;
      }
      if (newsPage > MAX_NEWS_PAGES) throw new Error(`IDX news exceeded ${MAX_NEWS_PAGES} pages`);

      let page = 1;
      let pages: number | null = null;
      while (page <= MAX_ANNOUNCEMENT_PAGES) {
        if (ctx.shouldYield()) return { status: "YIELDED" };
        const fetched = await fetchIdxAnnouncements(transport, page, from, to);
        if (!fetched.ok) throw new Error(`IDX announcement page ${page} unavailable: ${fetched.reason}`);
        const info = idxAnnouncementPageInfo(fetched.body);
        const actualPage = info.page ?? page;
        if (actualPage !== page) throw new Error(`IDX announcement page mismatch: requested ${page}, received ${actualPage}`);
        pages = info.pages ?? pages;
        if (info.rows === 0 && pages !== null && page <= pages) throw new Error(`IDX announcements returned an empty page ${page} before reported page count ${pages}`);
        const rows = parseIdxAnnouncements(fetched.body);
        stored += await (hooks.persistAnnouncements ?? upsertIdxAnnouncements)(services.db, rows, { source: source.id, asOf: services.now(), rawRef: null });
        if (pages !== null && page >= pages) break;
        if (rows.length < PAGE_SIZE && pages === null) break;
        page += 1;
      }
      if (page > MAX_ANNOUNCEMENT_PAGES) throw new Error(`IDX announcements exceeded ${MAX_ANNOUNCEMENT_PAGES} pages`);

      // Recent corporate actions keep the one-time historical import current without replaying the full archive.
      for (const category of hooks.categories ?? IDX_CA_TYPES) {
        if (ctx.shouldYield()) return { status: "YIELDED" };
        let start = 0;
        while (true) {
          const fetched = await fetchIdxActions(transport, category, start, undefined, fromDate, today);
          if (!fetched.ok) throw new Error(`IDX corporate action ${category} unavailable: ${fetched.reason}`);
          const parsed = parseIdxActions(fetched.body, category, start);
          if (parsed.total === null) throw new Error(`IDX corporate action ${category} page omitted total count`);
          stored += await (hooks.persistActions ?? upsertIdxActions)(services.db, parsed.rows, { source: source.id, asOf: services.now(), rawRef: null });
          if (parsed.complete) break;
          if (!parsed.rows.length || parsed.rows.length < ACTION_PAGE_SIZE) throw new Error(`IDX corporate action ${category} page was incomplete (${parsed.rows.length}/${parsed.total})`);
          start += ACTION_PAGE_SIZE;
        }
      }
      ctx.report.rows(stored);
      return { status: "SUCCEEDED" };
    },
  };
}
