// Resumable history backfill (§8.2: EOD from 2020-01-01). Runs in small batches in a night window as a
// background job, so it never competes with the daily EOD run; the cursor lives in job_cursors.
import { isTradingDay } from "@/lib/freshness/session";
import type { JobContext, JobDefinition } from "./scheduler";

export const BACKFILL_START = "2020-01-01";
/** Every 10 minutes, 19:00–05:59 WIB. */
export const NIGHT_WINDOW_CRON = "*/10 19-23,0-5 * * *";

const nextDay = (isoDate: string) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

export type BackfillOptions = {
  id: string;
  sourceId: string;
  /** First date to fetch (inclusive). */
  from?: string;
  /** Last date the backfill may reach (exclusive); the daily job owns everything from here on. */
  until: () => string;
  /** Trading days per run. */
  batchDays?: number;
  /** Optional version for an intentional replay of this date range; changing it restarts only this job at `from`. */
  cursorRevision?: string;
  cron?: string;
  processDay(date: string): Promise<{ rows: number; documentNew?: boolean }>;
};

export type ItemBackfillOptions = {
  id: string;
  sourceId?: string;
  /** Recorded in the cursor; a different value restarts the backfill (e.g. a new start date). */
  from?: string;
  /** Items still to cover, in order (e.g. symbols). New items (listings) join later runs automatically. */
  items(): Promise<string[]>;
  /** Items per run. */
  batchSize?: number;
  cron?: string;
  processItem(item: string, ctx: JobContext): Promise<{ rows: number; documentNew?: boolean }>;
};

/**
 * Per-item variant of the backfill for sources that serve a whole history per request (Yahoo: one call per symbol
 * from 2020-01-01). Same night window, background yielding and job_cursors cursor; the cursor lists finished items.
 */
export function itemBackfillJob(options: ItemBackfillOptions): JobDefinition {
  const from = options.from ?? BACKFILL_START;
  return {
    id: options.id,
    sourceId: options.sourceId,
    trigger: { kind: "cron", spec: options.cron ?? NIGHT_WINDOW_CRON },
    background: true,
    async run(ctx) {
      const saved = await ctx.cursor.get();
      const done = new Set(saved?.from === from && Array.isArray(saved.done) ? saved.done.filter((item): item is string => typeof item === "string") : []);
      const pending = (await options.items()).filter((item) => !done.has(item));
      for (const item of pending.slice(0, options.batchSize ?? 10)) {
        if (ctx.shouldYield()) return { status: "YIELDED" };
        const result = await options.processItem(item, ctx);
        ctx.report.rows(result.rows);
        if (result.documentNew !== undefined) ctx.report.document(result.documentNew);
        done.add(item);
        // Persist after every item so a crash or yield resumes at the next unfinished one.
        await ctx.cursor.set({ from, done: [...done], remaining: pending.filter((next) => !done.has(next)).length });
      }
      return { status: "SUCCEEDED" };
    },
  };
}

export function backfillJob(options: BackfillOptions): JobDefinition {
  const from = options.from ?? BACKFILL_START;
  return {
    id: options.id,
    sourceId: options.sourceId,
    trigger: { kind: "cron", spec: options.cron ?? NIGHT_WINDOW_CRON },
    background: true,
    async run(ctx) {
      const saved = await ctx.cursor.get();
      const cursorIdentity = options.cursorRevision === undefined ? from : `${from}:${options.cursorRevision}`;
      let date = from;
      if (typeof saved?.next === "string" && (options.cursorRevision === undefined || saved.updatedFor === cursorIdentity)) date = saved.next;
      const until = options.until();
      let done = 0;
      while (date < until && done < (options.batchDays ?? 5)) {
        if (ctx.shouldYield()) return { status: "YIELDED" };
        if (isTradingDay(date)) {
          const result = await options.processDay(date);
          ctx.report.rows(result.rows);
          if (result.documentNew !== undefined) ctx.report.document(result.documentNew);
          done += 1;
        }
        date = nextDay(date);
        // Persist after every day so a crash or yield resumes at the next unfetched date.
        await ctx.cursor.set({ next: date, updatedFor: cursorIdentity });
      }
      return { status: "SUCCEEDED" };
    },
  };
}
