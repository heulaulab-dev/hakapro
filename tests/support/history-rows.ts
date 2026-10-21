import { previousTradingDay } from "@/lib/freshness";
import type { HistoryRow } from "@/server/services/arjum-normalize";

/** Ascending daily rows ending on `end`, one per trading day. */
export function makeRows(closes: number[], options: { end?: string; foreign?: number[]; volume?: number[]; value?: number[]; frequency?: number[] } = {}): HistoryRow[] {
  const dates: string[] = [options.end ?? "2026-10-21"];
  while (dates.length < closes.length) dates.unshift(previousTradingDay(dates[0]));
  return closes.map((close, index) => ({
    date: dates[index], open: close, high: close, low: close, close, averageIdr: close,
    change: index ? close - closes[index - 1] : 0, changePercent: index ? ((close - closes[index - 1]) / closes[index - 1]) * 100 : 0,
    valueIdr: options.value?.[index] ?? close * 1_000_000, volumeShares: options.volume?.[index] ?? 1_000_000, frequency: options.frequency?.[index] ?? 100,
    foreignBuyShares: 0, foreignSellShares: 0, foreignNetShares: options.foreign?.[index] ?? 0,
  }));
}
