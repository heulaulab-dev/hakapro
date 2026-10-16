// EOD prices from Yahoo chart (§5.11 item 1, §8.2).
//   eod-daily: after 16:30 WIB on trading days, `range=5d` per active symbol (most liquid first) plus `^JKSE`. Runs
//   at 16:45, 18:45 and 20:45; each run only fetches symbols still missing the session's Yahoo row. The 20:45 run
//   (or any run after the session day) is final: a session still missing rows is marked STALE in eod_sessions.
//   eod-backfill: from 2020-01-01, one call per symbol (and `^JKSE`) in small night batches, as a background job
//   that yields to every other job. It stops before the current session, which belongs to the daily job.
// Yahoo is the primary OHLC source: it overwrites TradingView/Pasardana fallback rows, never their value/frequency.
import { z } from "zod";
import { jakartaClock } from "@/lib/freshness/session";
import {
  activeSymbols, recordEodSession, symbolsByLiquidity, symbolsWithDaily, upsertCorporateActions, upsertDaily, upsertIndexDaily, type ActionUpsert,
} from "../db/ingest";
import { FetchError, SourceBlockedError } from "../fetch/fetcher";
import { BACKFILL_START, itemBackfillJob } from "../schedule/backfill";
import type { JobContext, JobDefinition } from "../schedule/scheduler";
import { lastCompletedSession, wibMidnightEpoch, wibToday } from "../sources/session";
import { chartUrl, ChartMismatchError, IHSG_CODE, IHSG_YAHOO_SYMBOL, parseChart, yahooTicker, type ChartWindow, type YahooChart } from "../sources/yahoo";
import { fetchFor, parseDocument, provenanceOf, withSource, type JobServices, type SourceRef } from "./common";

export const EOD_DAILY_CRON = "45 16,18,20 * * *";
/** 20:45 WIB: the last scheduled attempt of the day finalizes the session. */
export const EOD_FINAL_ATTEMPT_MINUTES = 20 * 60 + 45;
/** Consecutive per-symbol failures (not blocks) that end a run: the endpoint has probably changed. */
export const MAX_CONSECUTIVE_FAILURES = 25;

export function chartActions(symbol: string, chart: YahooChart): ActionUpsert[] {
  return [
    ...chart.splits.map((split) => ({ symbol, type: "SPLIT" as const, exDate: split.exDate, ratio: split.ratio, description: `Stock split ${split.ratio}` })),
    ...chart.dividends.map((dividend) => ({ symbol, type: "DIVIDEND" as const, exDate: dividend.exDate, amount: dividend.amount, description: `Cash dividend IDR ${dividend.amount} per share` })),
  ];
}

/** Fetches and stores one symbol's chart; bars after `maxDate` (an unsettled session) are dropped. */
export async function ingestStockChart(services: JobServices, ctx: JobContext, source: SourceRef, symbol: string, window: ChartWindow, maxDate: string) {
  const ticker = yahooTicker(symbol);
  const result = await fetchFor(services, ctx, source, chartUrl(ticker, window));
  const chart = await parseDocument(services, result, (text) => parseChart(text, ticker));
  const prov = provenanceOf(result);
  const bars = chart.bars.filter((bar) => bar.date <= maxDate);
  let rows = await upsertDaily(services.db, bars.map((bar) => ({ symbol, ...bar })), prov, { primary: true, value: "none" });
  rows += await upsertCorporateActions(services.db, chartActions(symbol, chart), prov);
  return { rows, dates: new Set(bars.map((bar) => bar.date)), documentNew: result.kind === "new" };
}

/** IHSG from `^JKSE` as a fallback index_daily row (TradingView's index scan is primary). */
export async function ingestIhsgChart(services: JobServices, ctx: JobContext, source: SourceRef, window: ChartWindow, maxDate: string) {
  const result = await fetchFor(services, ctx, source, chartUrl(IHSG_YAHOO_SYMBOL, window));
  const chart = await parseDocument(services, result, (text) => parseChart(text, IHSG_YAHOO_SYMBOL));
  const bars = chart.bars.filter((bar) => bar.date <= maxDate);
  const rows = await upsertIndexDaily(services.db, bars.map((bar) => ({
    code: IHSG_CODE, date: bar.date, name: chart.name ?? "IDX Composite Index", open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    previousClose: bar.previousClose, changePercent: bar.previousClose ? bar.close / bar.previousClose - 1 : null,
  })), provenanceOf(result), { primary: false });
  return { rows, documentNew: result.kind === "new" };
}

/** A per-symbol failure that skips the symbol (not found, malformed, mismatched); blocks are never skipped. */
function skippable(error: unknown): boolean {
  if (error instanceof SourceBlockedError) return false;
  return error instanceof FetchError || error instanceof ChartMismatchError || error instanceof z.ZodError || error instanceof SyntaxError || (error instanceof Error && error.message === "Yahoo chart has no result");
}

export function eodDailyJob(services: JobServices, source: SourceRef): JobDefinition {
  return {
    id: "eod-daily",
    trigger: { kind: "cron", spec: EOD_DAILY_CRON, tradingDaysOnly: true },
    async run(ctx) {
      const now = services.now();
      const session = lastCompletedSession(now);
      const final = wibToday(now) > session || jakartaClock(now).minutes >= EOD_FINAL_ATTEMPT_MINUTES;
      let yielded = false;

      await withSource(services, ctx, source.id, async () => {
        let rows = 0;
        try {
          rows += (await ingestIhsgChart(services, ctx, source, { range: "5d" }, session)).rows;
        } catch (error) {
          if (!skippable(error)) throw error;
          services.log.warn("eod_index_failed", { job: ctx.jobId, message: error instanceof Error ? error.message : String(error) });
        }
        const have = await symbolsWithDaily(services.db, session, source.id);
        const queue = (await symbolsByLiquidity(services.db, session)).filter((symbol) => !have.has(symbol));
        let failures = 0;
        for (const symbol of queue) {
          if (ctx.shouldYield()) { yielded = true; break; }
          try {
            rows += (await ingestStockChart(services, ctx, source, symbol, { range: "5d" }, session)).rows;
            failures = 0;
          } catch (error) {
            if (!skippable(error)) throw error;
            failures += 1;
            services.log.warn("eod_symbol_failed", { job: ctx.jobId, symbol, message: error instanceof Error ? error.message : String(error) });
            if (failures >= MAX_CONSECUTIVE_FAILURES) throw new Error(`${failures} consecutive Yahoo failures; stopping the run`);
          }
        }
        return { value: null, rows };
      });

      const expected = await activeSymbols(services.db);
      const withRow = await symbolsWithDaily(services.db, session);
      const present = expected.filter((symbol) => withRow.has(symbol)).length;
      const status = present === expected.length && expected.length > 0 ? "COMPLETE" : final ? "STALE" : "PARTIAL";
      await recordEodSession(services.db, session, { status, expected: expected.length, present, final: final || status === "COMPLETE" });
      if (status === "STALE") services.log.warn("eod_session_stale", { session, expected: expected.length, present });
      return yielded ? { status: "YIELDED" } : undefined;
    },
  };
}

export function eodBackfillJob(services: JobServices, source: SourceRef, options: { batchSize?: number } = {}): JobDefinition {
  return itemBackfillJob({
    id: "eod-backfill",
    sourceId: source.id,
    from: BACKFILL_START,
    batchSize: options.batchSize ?? 10,
    items: async () => [IHSG_YAHOO_SYMBOL, ...(await activeSymbols(services.db))],
    async processItem(item, ctx) {
      const session = lastCompletedSession(services.now());
      // Up to (not including) the newest session: the daily job owns it.
      const window = { period1: wibMidnightEpoch(BACKFILL_START), period2: wibMidnightEpoch(session) };
      try {
        // Documents are counted by fetchFor; only rows are returned to the backfill.
        if (item === IHSG_YAHOO_SYMBOL) return { rows: (await ingestIhsgChart(services, ctx, source, window, session)).rows };
        return { rows: (await ingestStockChart(services, ctx, source, item, window, session)).rows };
      } catch (error) {
        // Not found or malformed: nothing to backfill for this item. Blocks and transient errors end the run.
        if (skippable(error) && !(error instanceof FetchError && error.retryable)) {
          services.log.warn("backfill_item_skipped", { item, message: error instanceof Error ? error.message : String(error) });
          return { rows: 0 };
        }
        throw error;
      }
    },
  });
}
