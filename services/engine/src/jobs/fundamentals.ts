// Financial statements from Yahoo fundamentals timeseries (E5, §5.5): one request per active symbol, most liquid
// first, in small night batches as a low-priority background job (it gives way to the EOD jobs and the EOD
// backfill, and stops at the next symbol when one starts). The cursor in job_cursors makes it resumable.
//   Weekly full refresh: every active symbol once per ISO week (the cycle restarts on Monday, WIB).
//   Earnings-season catch-up: inside the filing windows (mid-March to early May, mid-July to early August, mid-
//   October to early November), from Thursday to Sunday, symbols whose newest stored quarter is older than the
//   expected one are fetched once more after the week's full pass is done. Cheap: only lagging symbols.
// Yahoo chart and fundamentals share one host: the fetcher's per-host limiter spaces both (one request in flight,
// 3 s apart). A 429 on the fundamentals path also stops the chart source (one host-wide rate limit), and the job does
// not start while the chart source is blocked.
import { z } from "zod";
import { symbolsByLiquidity } from "../db/ingest";
import { latestQuarterEnds, upsertFinancials } from "../db/fundamentals";
import { FetchError, SourceBlockedError } from "../fetch/fetcher";
import type { JobContext, JobDefinition } from "../schedule/scheduler";
import { addDays, lastCompletedSession, wibToday } from "../sources/session";
import { FundamentalsMismatchError, fundamentalsUrl, parseFundamentals } from "../sources/yahoo-fundamentals";
import { yahooTicker } from "../sources/yahoo";
import { fetchFor, parseDocument, provenanceOf, type JobServices, type SourceRef } from "./common";

/** Every 10 minutes at :05, 19:00–05:59 WIB: between the EOD backfill's runs (:00, :10, …). */
export const FUNDAMENTALS_CRON = "5-55/10 19-23,0-5 * * *";
export const FUNDAMENTALS_BATCH = 20;
/** Consecutive per-symbol failures (not blocks) that end a run: the endpoint has probably changed. */
export const MAX_CONSECUTIVE_FAILURES = 25;
/** A quarter is expected once this many days have passed since its end (IDX quarterly filings are due in 30). */
export const QUARTER_EXPECTED_AFTER_DAYS = 21;
/** Filing windows (MM-DD, inclusive): FY + Q1, H1, Q3 reports. */
export const EARNINGS_WINDOWS: Array<[string, string]> = [["03-15", "05-10"], ["07-15", "08-10"], ["10-15", "11-10"]];

const DAY_MS = 86_400_000;

/** Monday (WIB date) of the ISO week containing `date`. */
export function weekStart(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export function inEarningsWindow(date: string): boolean {
  const monthDay = date.slice(5);
  return EARNINGS_WINDOWS.some(([from, to]) => monthDay >= from && monthDay <= to);
}

/** The newest calendar quarter end at least QUARTER_EXPECTED_AFTER_DAYS before `date`. */
export function expectedQuarterEnd(date: string): string {
  const ends = (year: number) => [`${year}-12-31`, `${year}-09-30`, `${year}-06-30`, `${year}-03-31`];
  const year = Number(date.slice(0, 4));
  const at = Date.parse(`${date}T00:00:00Z`);
  return [...ends(year), ...ends(year - 1)].find((end) => at - Date.parse(`${end}T00:00:00Z`) >= QUARTER_EXPECTED_AFTER_DAYS * DAY_MS)!;
}

export type FundamentalsCycle = { full: string; catchup: string | null; expectedQuarter: string };

/** The refresh cycles open at `now`: the week's full pass, and the catch-up pass (Thu–Sun inside a filing window). */
export function fundamentalsCycle(now: Date): FundamentalsCycle {
  const today = wibToday(now);
  const monday = weekStart(today);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const lateWeek = weekday === 0 || weekday >= 4;
  return { full: monday, catchup: inEarningsWindow(today) && lateWeek ? `${monday}-catchup` : null, expectedQuarter: expectedQuarterEnd(today) };
}

type Pass = { key: string; done: string[] };
const passSchema = z.object({ key: z.string(), done: z.array(z.string()) });
const cursorSchema = z.object({ full: passSchema.nullable().optional(), catchup: passSchema.nullable().optional() }).loose();

/** A per-symbol failure that skips the symbol for this cycle (not found, malformed, mismatched); never a block. */
function skippable(error: unknown): boolean {
  if (error instanceof SourceBlockedError) return false;
  if (error instanceof FetchError) return !error.retryable;
  return error instanceof FundamentalsMismatchError || error instanceof z.ZodError || error instanceof SyntaxError;
}

/** Fetches and stores one symbol's statement lines; returns the rows written. */
export async function ingestFundamentals(services: JobServices, ctx: JobContext, source: SourceRef, symbol: string): Promise<number> {
  const ticker = yahooTicker(symbol);
  // period2 = 00:00 WIB tomorrow: one stable URL per day for the document cache.
  const result = await fetchFor(services, ctx, source, fundamentalsUrl(ticker, addDays(wibToday(services.now()), 1)));
  const parsed = await parseDocument(services, result, (text) => parseFundamentals(text, ticker));
  if (parsed.currencies.length > 1) services.log.warn("fundamentals_mixed_currency", { symbol, currencies: parsed.currencies.join(",") });
  return upsertFinancials(services.db, symbol, parsed.points, provenanceOf(result));
}

export function fundamentalsJob(services: JobServices, source: SourceRef, options: { batchSize?: number; hostSources?: string[] } = {}): JobDefinition {
  const hostSources = options.hostSources ?? [];
  return {
    id: "fundamentals",
    sourceId: source.id,
    trigger: { kind: "cron", spec: FUNDAMENTALS_CRON },
    background: true,
    lowPriority: true,
    async run(ctx) {
      for (const other of hostSources) {
        // One host, one rate limit: a blocked chart source means this host is off limits too.
        if (await services.sourceState.isBlocked(other)) throw new SourceBlockedError(other, null);
      }
      const now = services.now();
      const cycle = fundamentalsCycle(now);
      const saved = cursorSchema.safeParse((await ctx.cursor.get()) ?? {});
      const full: Pass = saved.success && saved.data.full?.key === cycle.full ? saved.data.full : { key: cycle.full, done: [] };
      const catchup: Pass | null = cycle.catchup ? (saved.success && saved.data.catchup?.key === cycle.catchup ? saved.data.catchup : { key: cycle.catchup, done: [] }) : null;

      const symbols = await symbolsByLiquidity(services.db, lastCompletedSession(now));
      let pass: Pass = full;
      let queue = symbols.filter((symbol) => !full.done.includes(symbol));
      if (!queue.length && catchup) {
        const latest = await latestQuarterEnds(services.db, source.id);
        pass = catchup;
        queue = symbols.filter((symbol) => !catchup.done.includes(symbol) && (latest.get(symbol) ?? "") < cycle.expectedQuarter);
      }
      const save = () => ctx.cursor.set({ full, catchup, expectedQuarter: cycle.expectedQuarter, remaining: queue.filter((symbol) => !pass.done.includes(symbol)).length });

      let failures = 0;
      for (const symbol of queue.slice(0, options.batchSize ?? FUNDAMENTALS_BATCH)) {
        if (ctx.shouldYield()) return { status: "YIELDED" };
        try {
          ctx.report.rows(await ingestFundamentals(services, ctx, source, symbol));
          failures = 0;
        } catch (error) {
          if (error instanceof SourceBlockedError && error.evidence?.reason === "RATE_LIMITED") {
            // A 429 is the host's limit, not the path's: stop the chart source as well (no retry, §2).
            for (const other of hostSources) await services.sourceState.markBlocked(other, { ...error.evidence, reason: "RATE_LIMITED" });
          }
          if (!skippable(error)) throw error;
          failures += 1;
          services.log.warn("fundamentals_symbol_failed", { job: ctx.jobId, symbol, message: error instanceof Error ? error.message : String(error) });
          if (failures >= MAX_CONSECUTIVE_FAILURES) throw new Error(`${failures} consecutive Yahoo fundamentals failures; stopping the run`);
        }
        pass.done.push(symbol);
        // Persist after every symbol so a crash or yield resumes at the next one.
        await save();
      }
      return { status: "SUCCEEDED" };
    },
  };
}
