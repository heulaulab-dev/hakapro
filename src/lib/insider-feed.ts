import type { RecentInsider } from "@/lib/api/market";

/**
 * The largest insider purchases by value (|shares| × price), newest first on equal value. Purchases without a value
 * (no price reported) are left out rather than ranked as zero.
 */
export function topInsiderBuys(rows: RecentInsider[], count: number): RecentInsider[] {
  return rows
    .filter((row): row is RecentInsider & { valueIdr: number } => row.action === "BUY" && row.valueIdr !== null)
    .sort((a, b) => b.valueIdr - a.valueIdr || (a.date === b.date ? a.symbol.localeCompare(b.symbol) : a.date < b.date ? 1 : -1))
    .slice(0, count);
}
