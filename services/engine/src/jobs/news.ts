// News RSS (E3, §5.7, §5.11 item 4): every ENGINE_NEWS_INTERVAL_MINUTES (default 15) from 06:00 to 22:00 WIB, every
// day, one conditional GET per feed (ETag / Last-Modified; a 304 or byte-identical feed adds nothing). Hosts are at
// least 5 s apart (source policy). Each outlet is its own source: a block stops that outlet only, never retried.
// Stored: headline, canonical link, time, outlet, the feed's own summary and matched symbols. Never article bodies.
import { insertNews, knownSymbols } from "../db/market-info";
import { SourceBlockedError } from "../fetch/fetcher";
import { retentionCutoff } from "../registry";
import type { JobDefinition } from "../schedule/scheduler";
import { FEED_ACCEPT, parseNewsFeed, type NewsFeed } from "../sources/news";
import { fetchFor, parseDocument, provenanceOf, withSource, type JobServices, type SourceRef } from "./common";

export const NEWS_WINDOW = { from: "06:00", to: "22:00" } as const;

export type NewsFeedSource = NewsFeed & { source: SourceRef };

export function newsJob(services: JobServices, feeds: NewsFeedSource[], options: { everyMinutes: number; retentionDays: number }): JobDefinition {
  return {
    id: "news",
    trigger: { kind: "window", everyMinutes: Math.max(5, options.everyMinutes), ...NEWS_WINDOW },
    async run(ctx) {
      const known = await knownSymbols(services.db);
      const cutoff = retentionCutoff(services.now(), options.retentionDays);
      let ok = 0;
      let blocked = 0;
      let failed = 0;
      for (const feed of feeds) {
        if (ctx.shouldYield()) return { status: "YIELDED" };
        try {
          const outcome = await withSource(services, ctx, feed.source.id, async () => {
            const result = await fetchFor(services, ctx, feed.source, feed.url, { accept: FEED_ACCEPT });
            // 304, or the same bytes as a stored copy: its items were stored when that copy was new.
            if (result.kind !== "new") return { value: null, rows: 0 };
            const parsed = await parseDocument(services, result, (text) => parseNewsFeed(text, feed, result.document.fetchedAt, known));
            const items = parsed.items.filter((item) => item.publishedAt >= cutoff);
            return { value: null, rows: await insertNews(services.db, items, provenanceOf(result)) };
          });
          if (outcome.ok) ok += 1;
          else blocked += 1;
        } catch (error) {
          // A malformed or unreachable feed is recorded on its source; the other outlets still run.
          failed += 1;
          services.log.warn("news_feed_failed", { job: ctx.jobId, source: feed.source.id, url: feed.url, message: error instanceof Error ? error.message : String(error) });
        }
      }
      if (ok === 0 && blocked > 0 && failed === 0) throw new SourceBlockedError(feeds[0].source.id, null);
      if (ok === 0 && feeds.length > 0) throw new Error(`No news feed succeeded (${failed} failed, ${blocked} blocked)`);
    },
  };
}
