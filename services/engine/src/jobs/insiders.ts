// Market-wide insider feed from arjum: page 1 (15 rows, newest first) of `/api/insiders/{code}` per active symbol,
// rotating through the universe (never-read and longest-ago first, most liquid first within that) and re-reading a
// symbol at most once per ENGINE_ARJUM_INSIDER_REVISIT_DAYS. Registered only when ENGINE_ARJUM_INSIDER_BUDGET > 0.
// Every call comes out of the key's shared 1000/day quota, so the run stops at whichever comes first:
//   - ENGINE_ARJUM_INSIDER_BUDGET calls made today (WIB), counted in the job cursor across runs and restarts;
//   - the provider's x-ratelimit-remaining at or below ENGINE_ARJUM_RESERVE (the next call would dip into the app's
//     share). The last value seen is kept in the cursor, so later runs that day make no call at all;
//   - a 429 or auth failure: the fetcher marks arjum BLOCKED and the job stops (no retry, §2).
// Config validation already keeps ENGINE_ARJUM_DAILY_BUDGET + ENGINE_ARJUM_INSIDER_BUDGET within 1000 − reserve.
import { insiderQueue, recordInsiderCheck, upsertInsiderTransactions } from "../db/insiders";
import { FetchError } from "../fetch/fetcher";
import type { JobDefinition } from "../schedule/scheduler";
import { insidersUrl, parseInsiders, quotaRemaining } from "../sources/arjum";
import { addDays, lastCompletedSession, wibToday } from "../sources/session";
import type { ArjumConfig } from "../config";
import { fetchFor, parseDocument, provenanceOf, type JobServices, type SourceRef } from "./common";

/** Every 10 minutes from 21:30 to 23:30 WIB, every day: after foreign flow's 21:00 run, as a background job. */
export const INSIDER_FEED_TRIGGER = { kind: "window", everyMinutes: 10, from: "21:30", to: "23:30" } as const;

export type InsiderStop = "done" | "budget" | "reserve" | "yield";

type Cursor = { day: string; used: number; remaining: number | null; lastSymbol: string | null };

function readCursor(saved: Record<string, unknown> | null, today: string): Cursor {
  if (saved?.day !== today) return { day: today, used: 0, remaining: null, lastSymbol: null };
  return {
    day: today,
    used: typeof saved.used === "number" ? saved.used : 0,
    remaining: typeof saved.remaining === "number" ? saved.remaining : null,
    lastSymbol: typeof saved.lastSymbol === "string" ? saved.lastSymbol : null,
  };
}

export function insiderFeedJob(services: JobServices, source: SourceRef, config: Pick<ArjumConfig, "apiKey" | "baseUrl" | "insiderBudget" | "insiderRevisitDays" | "reserve">): JobDefinition {
  return {
    id: "insider-feed",
    sourceId: source.id,
    trigger: { ...INSIDER_FEED_TRIGGER },
    background: true,
    async run(ctx) {
      const now = services.now();
      const today = wibToday(now);
      const cursor = readCursor(await ctx.cursor.get(), today);
      const save = () => ctx.cursor.set({ ...cursor });
      // A symbol read on or before this date is due again.
      const revisitBefore = addDays(today, -config.insiderRevisitDays);
      let stop: InsiderStop = "done";
      let read = 0;
      let rows = 0;
      let queued = 0;

      const halt = (): InsiderStop | null => {
        if (cursor.used >= config.insiderBudget) return "budget";
        if (cursor.remaining !== null && cursor.remaining <= config.reserve) return "reserve";
        if (ctx.shouldYield()) return "yield";
        return null;
      };

      // Nothing left today: stop before reading the queue (no call, no query).
      const early = halt();
      if (early && early !== "yield") stop = early;
      else {
        const queue = await insiderQueue(services.db, lastCompletedSession(now), revisitBefore);
        queued = queue.length;
        for (const symbol of queue) {
          const reason = halt();
          if (reason) { stop = reason; break; }
          cursor.used += 1;
          cursor.lastSymbol = symbol;
          await save();
          let result;
          try {
            result = await fetchFor(services, ctx, source, insidersUrl(config.baseUrl, symbol), { headers: { "x-api-key": config.apiKey } });
          } catch (error) {
            // 404 is documented for unknown codes: record the read so the rotation moves on. Anything else ends the run.
            if (error instanceof FetchError && error.status === 404) {
              await recordInsiderCheck(services.db, symbol, { checkedDate: today, rows: 0, total: null }, { source: source.id, asOf: services.now(), rawRef: null });
              continue;
            }
            throw error;
          }
          cursor.remaining = quotaRemaining(result.headers) ?? cursor.remaining;
          await save();
          const page = await parseDocument(services, result, (text) => parseInsiders(text, symbol));
          for (const issue of page.issues) services.log.warn("insider_number_unparsed", { symbol, field: issue.field, reason: issue.reason });
          const prov = provenanceOf(result);
          const written = await upsertInsiderTransactions(services.db, symbol, page.rows, prov);
          await recordInsiderCheck(services.db, symbol, { checkedDate: today, rows: page.rows.length, total: page.total }, prov);
          ctx.report.rows(written);
          rows += written;
          read += 1;
        }
      }
      services.log.info("insider_feed_stopped", {
        reason: stop, used: cursor.used, budget: config.insiderBudget, remaining: cursor.remaining, reserve: config.reserve, read, rows, queued,
      });
      return stop === "yield" ? { status: "YIELDED" } : undefined;
    },
  };
}
