import type { HistoryRow } from "@/lib/api/market";
import { SESSIONS, type ChartRange } from "@/lib/charts/range";

/** Totals over the rows shown; pure so the client can recompute when the range changes. */
export function foreignRangeTotals(rows: Pick<HistoryRow, "foreignNetShares">[]) {
  return {
    sessions: rows.length,
    netShares: rows.reduce((sum, row) => sum + row.foreignNetShares, 0),
    buySessions: rows.filter((row) => row.foreignNetShares > 0).length,
    sellSessions: rows.filter((row) => row.foreignNetShares < 0).length,
  };
}

const CALENDAR_DAYS: Record<ChartRange, number> = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366 };

/** Provider start date for a range, counted back in calendar days from `today` (YYYY-MM-DD). */
export function rangeStartDate(range: ChartRange, today: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - CALENDAR_DAYS[range]);
  return date.toISOString().slice(0, 10);
}

export { SESSIONS };
