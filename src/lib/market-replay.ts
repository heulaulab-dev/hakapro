import type { BreadthHistory } from "@/server/schemas/market-intelligence";
import type { IndicesHistory } from "@/lib/api/market";

/** A replay frame uses the requested session exactly; a gap remains unavailable instead of carrying data forward. */
export function breadthAtDate(history: BreadthHistory | null | undefined, date: string): BreadthHistory["series"][number] | null {
  return history?.series.find((point) => point.date === date) ?? null;
}

export type ReplayIndexReturn = { close: number; returnPercent: number };

/** Relative index close between two exact sessions; null if either observation is absent or invalid. */
export function indexReturnAtDate(
  history: Pick<IndicesHistory, "series"> | null | undefined,
  code: string,
  baselineDate: string | null,
  date: string,
): ReplayIndexReturn | null {
  if (!history || !baselineDate) return null;
  const series = history.series.find((item) => item.code === code);
  const baseline = series?.points.find((point) => point.date === baselineDate)?.close;
  const close = series?.points.find((point) => point.date === date)?.close;
  if (baseline === undefined || close === undefined || !Number.isFinite(baseline) || !Number.isFinite(close) || baseline <= 0 || close <= 0) return null;
  return { close, returnPercent: ((close / baseline) - 1) * 100 };
}
