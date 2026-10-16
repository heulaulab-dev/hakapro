// Yahoo Finance chart JSON (DATA-ENGINE.md §5.2/§5.3/§5.6): per-symbol daily OHLCV (split-adjusted close plus
// `adjclose`), splits and dividends, and IHSG (`^JKSE`). Unofficial and per symbol only; best-effort (§8.6).
import { z } from "zod";
import { wibDateOfEpoch } from "./session";

export const YAHOO_ORIGIN = "https://query1.finance.yahoo.com";
export const YAHOO_HOST = "query1.finance.yahoo.com";
export const IHSG_YAHOO_SYMBOL = "^JKSE";
export const IHSG_CODE = "COMPOSITE";

export const yahooTicker = (symbol: string) => `${symbol}.JK`;

export type ChartWindow = { range: "5d" | "1mo" } | { period1: number; period2: number };

/** `.../v8/finance/chart/<ticker>?…&interval=1d&events=div,split`. */
export function chartUrl(ticker: string, window: ChartWindow): string {
  const params = new URLSearchParams("range" in window ? { range: window.range } : { period1: String(window.period1), period2: String(window.period2) });
  params.set("interval", "1d");
  params.set("events", "div,split");
  return `${YAHOO_ORIGIN}/v8/finance/chart/${encodeURIComponent(ticker)}?${params}`;
}

const series = z.array(z.number().nullable());
const chartSchema = z.object({
  chart: z.object({
    result: z.array(z.object({
      meta: z.object({
        symbol: z.string(),
        gmtoffset: z.number().int().default(25200),
        chartPreviousClose: z.number().nullable().optional(),
        longName: z.string().nullable().optional(),
        shortName: z.string().nullable().optional(),
      }).loose(),
      timestamp: z.array(z.number().int()).optional(),
      indicators: z.object({
        quote: z.array(z.object({ open: series.optional(), high: series.optional(), low: series.optional(), close: series.optional(), volume: series.optional() })).min(1),
        adjclose: z.array(z.object({ adjclose: series })).optional(),
      }),
      events: z.object({
        dividends: z.record(z.string(), z.object({ amount: z.number(), date: z.number().int() })).optional(),
        splits: z.record(z.string(), z.object({ date: z.number().int(), numerator: z.number(), denominator: z.number(), splitRatio: z.string().optional() })).optional(),
      }).optional(),
    })).nullable(),
    error: z.unknown().nullable().optional(),
  }),
});

export type YahooBar = {
  date: string; open: number | null; high: number | null; low: number | null; close: number;
  previousClose: number | null; volume: number | null; adjClose: number | null;
};
export type YahooSplit = { exDate: string; numerator: number; denominator: number; ratio: string };
export type YahooDividend = { exDate: string; amount: number };
export type YahooChart = { ticker: string; name: string | null; bars: YahooBar[]; splits: YahooSplit[]; dividends: YahooDividend[] };

export class ChartMismatchError extends Error {
  constructor(expected: string, got: string) {
    super(`Yahoo chart for ${got} returned where ${expected} was requested`);
    this.name = "ChartMismatchError";
  }
}

/**
 * Parses one chart response. Bars without a close are dropped (no trade, or not yet settled); the previous close
 * chains from `chartPreviousClose` and then bar to bar. Dates are the exchange's wall-clock dates.
 */
export function parseChart(textBody: string, expectedTicker: string): YahooChart {
  const parsed = chartSchema.parse(JSON.parse(textBody));
  const result = parsed.chart.result?.[0];
  if (!result) throw new Error("Yahoo chart has no result");
  if (result.meta.symbol.toUpperCase() !== expectedTicker.toUpperCase()) throw new ChartMismatchError(expectedTicker, result.meta.symbol);
  const offset = result.meta.gmtoffset;
  const quote = result.indicators.quote[0];
  const adj = result.indicators.adjclose?.[0]?.adjclose;
  const at = (values: Array<number | null> | undefined, i: number) => values?.[i] ?? null;

  const byDate = new Map<string, YahooBar>();
  let previousClose = result.meta.chartPreviousClose ?? null;
  for (const [i, epoch] of (result.timestamp ?? []).entries()) {
    const close = at(quote.close, i);
    if (close === null || close < 0) continue;
    const date = wibDateOfEpoch(epoch, offset);
    byDate.set(date, { date, open: at(quote.open, i), high: at(quote.high, i), low: at(quote.low, i), close, previousClose, volume: at(quote.volume, i), adjClose: at(adj, i) });
    previousClose = close;
  }
  const splits = Object.values(result.events?.splits ?? {}).map((split) => ({
    exDate: wibDateOfEpoch(split.date, offset), numerator: split.numerator, denominator: split.denominator,
    ratio: split.splitRatio ?? `${split.numerator}:${split.denominator}`,
  }));
  const dividends = Object.values(result.events?.dividends ?? {}).map((dividend) => ({ exDate: wibDateOfEpoch(dividend.date, offset), amount: dividend.amount }));
  return {
    ticker: result.meta.symbol, name: result.meta.longName ?? result.meta.shortName ?? null,
    bars: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    splits: splits.sort((a, b) => a.exDate.localeCompare(b.exDate)),
    dividends: dividends.sort((a, b) => a.exDate.localeCompare(b.exDate)),
  };
}
