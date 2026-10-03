// Ported from heulatrade lib/alerts/evaluate.ts. Domain `changePercent` is in percent units.
import type { Candle, Quote } from "@/server/market/types";

export type AlertRule = { metric: "PRICE" | "DAILY_CHANGE" | "FOREIGN_NET" | "VOLUME" | "VOLUME_RATIO_20D"; operator: "GT" | "GTE" | "LT" | "LTE"; threshold: number };

export function observedMetric(metric: AlertRule["metric"], quote: Quote, candles: Candle[]): number | null {
  if (metric === "PRICE") return quote.close;
  if (metric === "DAILY_CHANGE") return quote.changePercent;
  if (metric === "VOLUME") return quote.volumeShares;
  const latest = candles.at(-1);
  if (!latest || latest.date !== quote.date) return null;
  if (metric === "FOREIGN_NET") return foreignNet(latest.foreignBuyShares, latest.foreignSellShares);
  if (latest.volumeShares === null || candles.length < 21) return null;
  const history = candles.slice(-21, -1).map((row) => row.volumeShares);
  if (history.some((volume) => volume === null)) return null;
  const average = (history as number[]).reduce((sum, volume) => sum + volume, 0) / 20;
  return average > 0 ? latest.volumeShares / average : null;
}

export function triggered(rule: AlertRule, value: number | null): boolean {
  if (value === null || !Number.isFinite(value) || !Number.isFinite(rule.threshold)) return false;
  switch (rule.operator) {
    case "GT": return value > rule.threshold;
    case "GTE": return value >= rule.threshold;
    case "LT": return value < rule.threshold;
    case "LTE": return value <= rule.threshold;
  }
}

/** Foreign net flow = buy − sell (heulatrade components/panels/market-panels.tsx:56). Missing data stays null, never zero. */
export function foreignNet(buy: number | null, sell: number | null): number | null {
  return buy === null || sell === null ? null : buy - sell;
}
