// Resumable history backfill (§8.2: EOD from 2020-01-01). Runs in small batches in a night window as a
// background job, so it never competes with the daily EOD run; the cursor lives in job_cursors.
import { isTradingDay } from "@/lib/freshness/session";
import type { JobDefinition } from "./scheduler";

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
  cron?: string;
  processDay(date: string): Promise<{ rows: number; documentNew?: boolean }>;
};

export function backfillJob(options: BackfillOptions): JobDefinition {
  const from = options.from ?? BACKFILL_START;
  return {
    id: options.id,
    sourceId: options.sourceId,
    trigger: { kind: "cron", spec: options.cron ?? NIGHT_WINDOW_CRON },
    background: true,
    async run(ctx) {
      const saved = await ctx.cursor.get();
      let date = typeof saved?.next === "string" ? saved.next : from;
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
        await ctx.cursor.set({ next: date, updatedFor: from });
      }
      return { status: "SUCCEEDED" };
    },
  };
}
