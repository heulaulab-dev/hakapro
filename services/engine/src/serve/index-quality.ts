// Data-quality / coverage checks over stored index_daily series (Phase 7–8: validation + ingestion observability).
// Pure and deterministic; the calendar dependency is injected so the checks are hand-verifiable in tests. These are
// GENERIC index-health signals (what is stored, is it fresh, are the closes valid) — the RRG-specific "enough
// observations to compute" judgement stays in the app's sector-rotation engine, which owns the methodology window.
import { isTradingDay } from "@/lib/freshness/session";

export const INDEX_QUALITY_FLAGS = ["STALE", "NON_POSITIVE_CLOSE", "UNORDERED"] as const;
export type IndexQualityFlag = (typeof INDEX_QUALITY_FLAGS)[number];

/** A trading session with no new observation for this many trading days (beyond the expected one-day lag) is stale. */
export const STALE_TRADING_DAYS = 2;

export type IndexSeriesInput = { code: string; name: string | null; points: { date: string; close: number }[] };

export type IndexCoverage = {
  code: string;
  name: string | null;
  /** Observations actually stored in the requested range. */
  count: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Trading days spanned by [firstDate, lastDate] inclusive (the sessions we would expect over the covered span). */
  spanTradingDays: number;
  /** spanTradingDays − count: sessions missing inside the covered span (never negative). */
  missingSessions: number;
  /** Trading days from the day after lastDate up to `today` with no observation (0 while fresh). */
  staleTradingDays: number;
  flags: IndexQualityFlag[];
};

const nextIso = (iso: string): string => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/** Trading days in [from, to] inclusive. 0 when from > to. */
export function tradingDaysBetween(from: string, to: string, isTrading: (iso: string) => boolean = isTradingDay): number {
  if (from > to) return 0;
  let count = 0;
  for (let date = from; date <= to; date = nextIso(date)) if (isTrading(date)) count += 1;
  return count;
}

/** Coverage + quality for one code's series (points assumed oldest-first, as the store returns them). */
export function indexCoverage(series: IndexSeriesInput, today: string, isTrading: (iso: string) => boolean = isTradingDay): IndexCoverage {
  const points = series.points;
  const base = { code: series.code, name: series.name };
  if (!points.length) {
    return { ...base, count: 0, firstDate: null, lastDate: null, spanTradingDays: 0, missingSessions: 0, staleTradingDays: 0, flags: [] };
  }
  const flags: IndexQualityFlag[] = [];
  let ordered = true;
  for (let i = 1; i < points.length; i += 1) if (points[i].date <= points[i - 1].date) { ordered = false; break; }
  if (!ordered) flags.push("UNORDERED");
  if (points.some((point) => !(point.close > 0))) flags.push("NON_POSITIVE_CLOSE");

  const first = points[0].date;
  const last = points[points.length - 1].date;
  const spanTradingDays = tradingDaysBetween(first, last, isTrading);
  const missingSessions = Math.max(0, spanTradingDays - points.length);
  const staleTradingDays = tradingDaysBetween(nextIso(last), today, isTrading);
  if (staleTradingDays >= STALE_TRADING_DAYS) flags.push("STALE");

  return { ...base, count: points.length, firstDate: first, lastDate: last, spanTradingDays, missingSessions, staleTradingDays, flags };
}

/** Coverage for every code's series. */
export function indexCoverageReport(series: IndexSeriesInput[], today: string, isTrading: (iso: string) => boolean = isTradingDay): IndexCoverage[] {
  return series.map((one) => indexCoverage(one, today, isTrading));
}
