export type Mover = { symbol: string | null; name: string | null; close: number | null; changePercent: number | null; volumeShares: number | null; valueIdr: number | null; frequency: number | null };
export type MoverView = "gainers" | "losers" | "active";

/** Gainers/losers only among stocks that actually traded this much (filters illiquid spikes). */
export const MIN_VALUE_IDR = 1_000_000_000;

/** Ranks the full session list. Rows without the needed figure are excluded, never treated as zero. */
export function rankMovers(movers: Mover[], view: MoverView, limit = 20): Array<Mover & { symbol: string }> {
  const valid = movers.filter((row): row is Mover & { symbol: string } => Boolean(row.symbol));
  if (view === "active") return valid.filter((row) => row.valueIdr !== null).sort((a, b) => b.valueIdr! - a.valueIdr!).slice(0, limit);
  const liquid = valid.filter((row) => row.changePercent !== null && row.valueIdr !== null && row.valueIdr >= MIN_VALUE_IDR);
  const sorted = liquid.sort((a, b) => (view === "gainers" ? b.changePercent! - a.changePercent! : a.changePercent! - b.changePercent!));
  return sorted.filter((row) => (view === "gainers" ? row.changePercent! > 0 : row.changePercent! < 0)).slice(0, limit);
}
