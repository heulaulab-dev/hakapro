const SYMBOL_RE = /^[A-Z]{4}$/;

export type ComparisonPoint = { date: string; close: number };
export type NormalizedComparisonPoint = { date: string; value: number };

export function normalizeComparisonSeries(points: ComparisonPoint[], minimumPoints = 2): { points: NormalizedComparisonPoint[]; returnPercent: number | null } {
  const valid = points
    .filter((point) => point.date && Number.isFinite(point.close) && point.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (valid.length < minimumPoints) return { points: [], returnPercent: null };
  const baseline = valid[0].close;
  const normalized = valid.map((point) => ({ date: point.date, value: Math.round((point.close / baseline) * 10_000) / 100 }));
  return { points: normalized, returnPercent: Math.round(((valid.at(-1)!.close / baseline) - 1) * 10_000) / 100 };
}

export function normalizeComparisonSymbols(value: string | null, max = 4): string[] {
  if (!value) return [];
  return [...new Set(value.split(/[\s,]+/).map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => SYMBOL_RE.test(symbol)))].slice(0, max);
}
