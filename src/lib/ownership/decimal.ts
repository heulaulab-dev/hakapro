/**
 * Exact arithmetic for ownership figures. Share counts are integers of any size (`numeric(24,0)`), handled as BigInt.
 * Percentages have at most 6 decimals (`numeric(9,6)`), handled as integer micro-percent (1 % = 1,000,000), so a
 * percentage-point delta is exact for whatever precision the source published. No floating point is used.
 */

export const SHARES_PATTERN = /^\d{1,24}$/;
export const PERCENT_PATTERN = /^\d{1,3}(?:\.\d{1,6})?$/;

const MICRO = 1_000_000;
export const HUNDRED_PERCENT_MICRO = 100 * MICRO;

/** "41.1" → 41_100_000. Throws on anything that isn't a plain non-negative decimal with ≤6 decimals. */
export function percentToMicro(value: string): number {
  const match = /^(\d{1,3})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw new Error(`Invalid percentage "${value}"`);
  return Number(match[1]) * MICRO + Number((match[2] ?? "").padEnd(6, "0"));
}

/** 41_100_000 → "41.100000"; -250_000 → "-0.250000". Always 6 decimals. */
export function microToPercent(micro: number): string {
  if (!Number.isSafeInteger(micro)) throw new Error(`Invalid micro-percent ${micro}`);
  const sign = micro < 0 ? "-" : "";
  const abs = Math.abs(micro);
  return `${sign}${Math.floor(abs / MICRO)}.${String(abs % MICRO).padStart(6, "0")}`;
}

/** Canonical 6-decimal form of a percentage string ("41.1" → "41.100000"). */
export function canonicalPercent(value: string): string {
  return microToPercent(percentToMicro(value));
}

export function parseShares(value: string): bigint {
  if (!SHARES_PATTERN.test(value)) throw new Error(`Invalid share count "${value}"`);
  return BigInt(value);
}
