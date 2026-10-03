export const FRESHNESS_STATES = ["LIVE", "DELAYED", "EOD", "HISTORICAL", "STALE", "UNAVAILABLE"] as const;
export type Freshness = (typeof FRESHNESS_STATES)[number];

export type WithFreshness<T> = {
  data: T;
  freshness: Freshness;
  /** ISO date/timestamp of the underlying data, never of the request. Null only when freshness is UNAVAILABLE. */
  asOf: string | null;
  /** Reporting period for periodic datasets, e.g. "Q1 2026". */
  period?: string;
  /** Provider/lane identifier, e.g. "arjum", "idx-bei", "fixture:arjum". */
  source: string;
};

export function withFreshness<T>(
  data: T,
  meta: { freshness: Freshness; asOf: string | null; source: string; period?: string },
): WithFreshness<T> {
  // An unknown as-of can never be presented as anything but UNAVAILABLE.
  const freshness = meta.asOf === null ? "UNAVAILABLE" : meta.freshness;
  return { data, freshness, asOf: meta.asOf, source: meta.source, ...(meta.period ? { period: meta.period } : {}) };
}

export { classifySessionDate, jakartaClock, marketPhase, previousTradingDay, isTradingDay } from "./session";
