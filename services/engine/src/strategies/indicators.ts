// Common definitions (STRATEGY-RULES draft §3.1). Pure functions over daily bars sorted oldest first.

/** One stored daily row (daily_prices) as the rules read it. Prices are IDR, volume shares, value IDR. */
export type Bar = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  value: number | null;
};

/** A bar whose OHLC has passed G6, so every field the rules read is present. */
export type CheckedBar = Bar & { open: number; high: number; low: number };

/**
 * Thresholds are inclusive (§3.2). Ratios are float64, so a value that equals a threshold on paper (0.8, 1.5) may land
 * a few ulps below it; comparisons allow that rounding noise and nothing more.
 */
const EPSILON = 1e-9;
export const atLeast = (value: number, threshold: number) => value >= threshold - EPSILON * Math.max(1, Math.abs(threshold));
export const atMost = (value: number, threshold: number) => value <= threshold + EPSILON * Math.max(1, Math.abs(threshold));

export const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Shares traded; a missing volume counts as no trade. */
export const volumeOf = (bar: Bar) => bar.volume ?? 0;

/**
 * Traded value in IDR: the stored session value when a source reported one, otherwise close × volume. The draft's
 * test tables use exactly that proxy (avgVal_5 ≈ Rp 1.024 bn from C × V), and Yahoo history rows carry no value.
 */
export const valueOf = (bar: Bar) => bar.value ?? bar.close * volumeOf(bar);

/** The `n` bars before the last one (t), oldest first: the draft's lookback windows exclude t. */
export const before = <T>(bars: T[], n: number, end = bars.length - 1) => bars.slice(Math.max(0, end - n), end);

/** CLV = (C − L) / (H − L); on a single-price day, 1 if C ≥ prevClose, otherwise 0 (§3.1). */
export function closeLocation(bar: CheckedBar, previousClose: number): number {
  if (bar.high === bar.low) return bar.close >= previousClose ? 1 : 0;
  return (bar.close - bar.low) / (bar.high - bar.low);
}

export type Bands = { lower: number; middle: number; upper: number; bandwidthPercent: number };

/**
 * Bollinger bands on the `period` closes ending at `index` (inclusive): middle = SMA, ± k population σ (÷ n, §3.1).
 * Null when there are not enough closes.
 */
export function bollinger(closes: number[], index: number, period: number, k: number): Bands | null {
  if (index - period + 1 < 0 || index >= closes.length) return null;
  const window = closes.slice(index - period + 1, index + 1);
  const middle = mean(window);
  const sigma = Math.sqrt(mean(window.map((close) => (close - middle) ** 2)));
  const lower = middle - k * sigma;
  const upper = middle + k * sigma;
  return { lower, middle, upper, bandwidthPercent: middle === 0 ? 0 : ((upper - lower) / middle) * 100 };
}

/** Rounds a metric for storage and display; the qualification itself always uses full precision. */
export function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
