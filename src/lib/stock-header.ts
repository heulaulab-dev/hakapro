import { SHARES_PER_LOT } from "@/lib/format";

/** The figures a trader wants next to the price without scrolling: turnover, volume, foreign net, day range. */
export type HeaderStats = {
  valueIdr: number | null;
  volumeShares: number | null;
  /** Only known for completed sessions (the provider's daily row); null while the price comes from today's quote. */
  foreignNetShares: number | null;
  low: number | null;
  high: number | null;
};

type SessionRow = { valueIdr: number; volumeShares: number; foreignNetShares: number; low: number; high: number };
type TodayQuote = { lots: number; valueIdr: number };

/**
 * Header figures for the session the price belongs to. When the price comes from today's quote its
 * turnover and lots are used (the daily row is still yesterday's); otherwise the daily row is. Fields
 * the source does not carry stay null: nothing is shown as zero.
 */
export function headerStats(row: SessionRow | null | undefined, today: TodayQuote | null | undefined, fromPrice: boolean): HeaderStats {
  if (fromPrice && today) {
    return { valueIdr: today.valueIdr, volumeShares: today.lots * SHARES_PER_LOT, foreignNetShares: null, low: null, high: null };
  }
  if (!row) return { valueIdr: null, volumeShares: null, foreignNetShares: null, low: null, high: null };
  return { valueIdr: row.valueIdr, volumeShares: row.volumeShares, foreignNetShares: row.foreignNetShares, low: row.low, high: row.high };
}
