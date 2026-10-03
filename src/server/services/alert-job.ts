import { z } from "zod";
import type { WithFreshness } from "@/lib/freshness";
import type { History } from "./arjum-normalize";
import type { Candle, Quote } from "@/server/market/types";
import { observedMetric, triggered, type AlertRule } from "./alerts";

const alertRowSchema = z.object({
  id: z.string().uuid(),
  symbol: z.string().regex(/^[A-Z0-9]{1,12}$/),
  metric: z.enum(["PRICE", "DAILY_CHANGE", "FOREIGN_NET", "VOLUME", "VOLUME_RATIO_20D"]),
  operator: z.enum(["GT", "GTE", "LT", "LTE"]),
  threshold: z.coerce.number().finite(),
});

/** Daily history → the Quote/Candle shapes the alert rules evaluate. */
export function quoteFromHistory(history: History): { quote: Quote; candles: Candle[] } | null {
  const latest = history.rows.at(-1);
  if (!latest) return null;
  const candles: Candle[] = history.rows.map((row) => ({ date: row.date, open: row.open, high: row.high, low: row.low, close: row.close, volumeShares: row.volumeShares, foreignBuyShares: row.foreignBuyShares, foreignSellShares: row.foreignSellShares }));
  const quote: Quote = {
    symbol: history.symbol, date: latest.date, open: latest.open, high: latest.high, low: latest.low, close: latest.close,
    previousClose: latest.close - latest.change, change: latest.change, changePercent: latest.changePercent,
    volumeShares: latest.volumeShares, valueIdr: latest.valueIdr, frequency: latest.frequency,
    foreignBuyShares: latest.foreignBuyShares, foreignSellShares: latest.foreignSellShares,
  };
  return { quote, candles };
}

export type AlertJobDeps = {
  /** Enabled alerts, page by page (offset, size). */
  fetchAlerts: (offset: number, size: number) => Promise<unknown[]>;
  /** Daily history with freshness for a symbol. */
  getHistory: (symbol: string) => Promise<WithFreshness<History>>;
  /** Idempotent insert keyed by (alert_id, observed_as_of); resolves true when a new event was created. */
  insertEvent: (event: { alertId: string; value: number; asOf: string }) => Promise<boolean>;
};

export type AlertJobResult = { evaluated: number; triggered: number; unavailable: number; failed: number };

const PAGE = 200;

/**
 * Evaluates enabled alerts against final end-of-day data only. Anything not EOD (intraday DELAYED,
 * STALE, HISTORICAL fixtures, UNAVAILABLE) is counted as unavailable rather than evaluated.
 */
export async function runAlertJob(deps: AlertJobDeps): Promise<AlertJobResult> {
  const result: AlertJobResult = { evaluated: 0, triggered: 0, unavailable: 0, failed: 0 };
  const cache = new Map<string, ReturnType<typeof quoteFromHistory> & { asOf: string } | null>();
  for (let offset = 0; ; offset += PAGE) {
    const rows = await deps.fetchAlerts(offset, PAGE);
    for (const raw of rows) {
      const parsed = alertRowSchema.safeParse(raw);
      if (!parsed.success) { result.failed += 1; continue; }
      const alert = parsed.data;
      if (!cache.has(alert.symbol)) {
        try {
          const envelope = await deps.getHistory(alert.symbol);
          const snapshot = envelope.freshness === "EOD" && envelope.asOf ? quoteFromHistory(envelope.data) : null;
          cache.set(alert.symbol, snapshot && snapshot.quote.date === envelope.asOf ? { ...snapshot, asOf: envelope.asOf } : null);
        } catch {
          cache.set(alert.symbol, null);
        }
      }
      const snapshot = cache.get(alert.symbol);
      if (!snapshot) { result.unavailable += 1; continue; }
      const value = observedMetric(alert.metric as AlertRule["metric"], snapshot.quote, snapshot.candles);
      if (value === null) { result.unavailable += 1; continue; }
      result.evaluated += 1;
      if (!triggered(alert, value)) continue;
      try {
        if (await deps.insertEvent({ alertId: alert.id, value, asOf: snapshot.asOf })) result.triggered += 1;
      } catch {
        result.failed += 1;
      }
    }
    if (rows.length < PAGE) break;
  }
  return result;
}
