export const CHART_RANGES = ["1M", "3M", "6M", "1Y"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];
export const DEFAULT_RANGE: ChartRange = "3M";

/** Approximate IDX trading sessions per range. */
export const SESSIONS: Record<ChartRange, number> = { "1M": 21, "3M": 63, "6M": 126, "1Y": 252 };

/** Last N sessions of an ascending series. Reports whether the data was shorter than the range. */
export function sliceByRange<T>(rows: T[], range: ChartRange): { rows: T[]; limited: boolean } {
  const sessions = SESSIONS[range];
  return { rows: rows.slice(-sessions), limited: rows.length < sessions };
}
