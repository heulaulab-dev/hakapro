/** Pure scaling helpers for inline bars and proportion strips. Results are percentages 0-100. */

/** Width of a bar relative to the list maximum; null/negative/non-finite values map to 0. */
export function barPercent(value: number | null | undefined, max: number): number {
  if (value === null || value === undefined || !Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || value <= 0) return 0;
  return Math.min(100, (value / max) * 100);
}

/** Maximum finite positive value in a list (0 when none). */
export function maxOf(values: Array<number | null | undefined>): number {
  let max = 0;
  for (const value of values) if (typeof value === "number" && Number.isFinite(value) && value > max) max = value;
  return max;
}

/** Integer shares of a total that add to 100 when the total is positive (largest remainder). */
export function proportions(parts: number[]): number[] {
  const clean = parts.map((part) => (Number.isFinite(part) && part > 0 ? part : 0));
  const total = clean.reduce((sum, part) => sum + part, 0);
  if (total === 0) return clean.map(() => 0);
  const raw = clean.map((part) => (part / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((sum, part) => sum + part, 0);
  const order = raw.map((value, index) => ({ index, rem: value - Math.floor(value) })).sort((a, b) => b.rem - a.rem);
  for (const { index } of order) { if (left <= 0) break; floors[index] += 1; left -= 1; }
  return floors;
}

/** Intensity tier 0-3 of an absolute change versus a cap, a subtle shading cue (never the only signal). */
export function intensityTier(percent: number | null | undefined, cap = 10): 0 | 1 | 2 | 3 {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return 0;
  const ratio = Math.min(1, Math.abs(percent) / cap);
  return ratio === 0 ? 0 : ratio < 0.25 ? 1 : ratio < 0.6 ? 2 : 3;
}
