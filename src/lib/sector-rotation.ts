// Independent, transparent RRG-style sector-rotation engine. NOT the proprietary JdK
// RS-Ratio/RS-Momentum — a documented approximation (price relative → SMA → rolling
// z-score, centred on 100). See docs/research/sector-rotation-analysis.md. Pure and
// deterministic: no I/O, no Date.now(), no look-ahead.

export type RrgInterval = "daily" | "weekly";
export type Quadrant = "leading" | "weakening" | "lagging" | "improving";

export type RrgParams = {
  /** SMA length applied to the price relative. */
  smooth: number;
  /** Rolling window for standardising RS-Ratio. */
  normWindow: number;
  /** Rolling window for standardising RS-Momentum. */
  momentumWindow: number;
  /** Spread multiplier around the 100 centre. */
  scale: number;
};

export const RRG_PARAM_DEFAULTS: Record<RrgInterval, RrgParams> = {
  daily: { smooth: 5, normWindow: 20, momentumWindow: 10, scale: 1 },
  weekly: { smooth: 4, normWindow: 12, momentumWindow: 5, scale: 1 },
};

/** One close observation. `close` null/≤0 rows are dropped during alignment. */
export type ClosePoint = { date: string; close: number | null };
export type RrgPoint = { date: string; rsRatio: number; rsMomentum: number; quadrant: Quadrant };

export type SectorRotation = {
  sectorId: string;
  sectorName: string;
  benchmarkId: string;
  /** Chronological valid points (oldest → newest). */
  points: RrgPoint[];
  latest: RrgPoint | null;
};

/** Minimum aligned observations before a single RRG point exists: s + N + M − 1. */
export function minObservations(p: RrgParams): number {
  return p.smooth + p.normWindow + p.momentumWindow - 1;
}

export function quadrantOf(rsRatio: number, rsMomentum: number): Quadrant {
  const strong = rsRatio >= 100;
  const rising = rsMomentum >= 100;
  if (strong && rising) return "leading";
  if (strong && !rising) return "weakening";
  if (!strong && rising) return "improving";
  return "lagging";
}

/** Population mean/std over a full window ending at `end` (inclusive). null if window not full. */
function windowStats(values: number[], end: number, window: number): { mean: number; sd: number } | null {
  const start = end - window + 1;
  if (start < 0) return null;
  let sum = 0;
  for (let i = start; i <= end; i++) sum += values[i];
  const mean = sum / window;
  let variance = 0;
  for (let i = start; i <= end; i++) variance += (values[i] - mean) ** 2;
  return { mean, sd: Math.sqrt(variance / window) };
}

/** Simple moving average aligned to the input; entries before the window is full are null. */
function sma(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    out.push(i >= window - 1 ? sum / window : null);
  }
  return out;
}

/** Align two close series on the intersection of dates with finite, positive closes. */
export function alignCloses(sector: ClosePoint[], benchmark: ClosePoint[]): { dates: string[]; sector: number[]; benchmark: number[] } {
  const b = new Map<string, number>();
  for (const row of benchmark) if (row.close !== null && Number.isFinite(row.close) && row.close > 0) b.set(row.date, row.close);
  const dates: string[] = [];
  const s: number[] = [];
  const bench: number[] = [];
  for (const row of [...sector].sort((x, y) => x.date.localeCompare(y.date))) {
    if (row.close === null || !Number.isFinite(row.close) || row.close <= 0) continue;
    const bc = b.get(row.date);
    if (bc === undefined) continue;
    dates.push(row.date);
    s.push(row.close);
    bench.push(bc);
  }
  return { dates, sector: s, benchmark: bench };
}

/** Resample to the last close of each ISO week (YYYY-Www), preserving order. */
export function toWeekly(points: ClosePoint[]): ClosePoint[] {
  const byWeek = new Map<string, ClosePoint>();
  for (const row of [...points].sort((a, b) => a.date.localeCompare(b.date))) {
    byWeek.set(isoWeekKey(row.date), row); // later date in the week overwrites → last close
  }
  return [...byWeek.values()];
}

function isoWeekKey(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - day + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Core series calculation (already-aligned closes). Returns only valid (non-null) points. */
export function rrgSeries(dates: string[], sectorCloses: number[], benchmarkCloses: number[], params: RrgParams): RrgPoint[] {
  const n = dates.length;
  if (n === 0) return [];
  const rel = sectorCloses.map((s, i) => s / benchmarkCloses[i]);
  const rs1 = sma(rel, params.smooth);

  // RS-Ratio: rolling z-score of the smoothed relative over normWindow.
  const smoothed: number[] = [];
  const smoothedIndex: number[] = []; // original index for each smoothed value
  rs1.forEach((v, i) => { if (v !== null) { smoothed.push(v); smoothedIndex.push(i); } });
  const rsRatio: (number | null)[] = new Array(n).fill(null);
  for (let j = 0; j < smoothed.length; j++) {
    const stats = windowStats(smoothed, j, params.normWindow);
    if (!stats || stats.sd === 0) continue;
    rsRatio[smoothedIndex[j]] = 100 + params.scale * ((smoothed[j] - stats.mean) / stats.sd);
  }

  // Raw momentum: first difference of consecutive valid RS-Ratio values.
  const ratioVals: number[] = [];
  const ratioIndex: number[] = [];
  rsRatio.forEach((v, i) => { if (v !== null) { ratioVals.push(v); ratioIndex.push(i); } });
  const mom: number[] = [];
  const momIndex: number[] = [];
  for (let j = 1; j < ratioVals.length; j++) {
    mom.push(ratioVals[j] - ratioVals[j - 1]);
    momIndex.push(ratioIndex[j]);
  }

  // RS-Momentum: rolling z-score of momentum over momentumWindow.
  const out: RrgPoint[] = [];
  for (let j = 0; j < mom.length; j++) {
    const stats = windowStats(mom, j, params.momentumWindow);
    if (!stats || stats.sd === 0) continue;
    const idx = momIndex[j];
    const ratio = rsRatio[idx]!;
    const momentum = 100 + params.scale * ((mom[j] - stats.mean) / stats.sd);
    out.push({ date: dates[idx], rsRatio: ratio, rsMomentum: momentum, quadrant: quadrantOf(ratio, momentum) });
  }
  return out;
}

export type DirectionVector = { dx: number; dy: number; angleDeg: number; velocity: number };

/** Vector from the previous to the latest point of a tail; null with < 2 points. */
export function directionVector(points: RrgPoint[]): DirectionVector | null {
  if (points.length < 2) return null;
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  const dx = b.rsRatio - a.rsRatio;
  const dy = b.rsMomentum - a.rsMomentum;
  return { dx, dy, angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI, velocity: Math.hypot(dx, dy) };
}

export type SectorInput = { id: string; name: string; series: ClosePoint[] };
export type RotationResult = {
  benchmarkId: string;
  interval: RrgInterval;
  params: RrgParams;
  required: number;
  /** Max aligned observations across sectors (data-availability headline). */
  available: number;
  sufficient: boolean;
  rotations: SectorRotation[];
  /** Per-sector aligned-observation counts (for coverage reporting). */
  coverage: Array<{ sectorId: string; aligned: number; points: number }>;
};

/**
 * Full computation for a benchmark + sectors. Does not throw on short data: it reports
 * `sufficient=false` and `rotations` with whatever valid points exist (possibly none).
 */
export function computeRotation(
  benchmark: { id: string; series: ClosePoint[] },
  sectors: SectorInput[],
  interval: RrgInterval,
  params: RrgParams = RRG_PARAM_DEFAULTS[interval],
): RotationResult {
  const required = minObservations(params);
  const benchSeries = interval === "weekly" ? toWeekly(benchmark.series) : benchmark.series;
  const rotations: SectorRotation[] = [];
  const coverage: RotationResult["coverage"] = [];
  let available = 0;
  for (const sector of sectors) {
    const secSeries = interval === "weekly" ? toWeekly(sector.series) : sector.series;
    const aligned = alignCloses(secSeries, benchSeries);
    available = Math.max(available, aligned.dates.length);
    const points = rrgSeries(aligned.dates, aligned.sector, aligned.benchmark, params);
    coverage.push({ sectorId: sector.id, aligned: aligned.dates.length, points: points.length });
    rotations.push({ sectorId: sector.id, sectorName: sector.name, benchmarkId: benchmark.id, points, latest: points.at(-1) ?? null });
  }
  return { benchmarkId: benchmark.id, interval, params, required, available, sufficient: available >= required, rotations, coverage };
}

/** Human-facing quadrant labels keyed for i18n (`sectorRotation.quadrants.<key>`). */
export const QUADRANTS: Quadrant[] = ["leading", "weakening", "improving", "lagging"];
