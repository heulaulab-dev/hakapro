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

/** Lane ids the HAKA PRO engine serves data through; users see the one brand, never the upstream lane. */
const ENGINE_LANES = new Set(["arjum", "idx-bei"]);

/** The product name for the data engine, shown wherever a dataset's source reaches the user. */
export const ENGINE_SOURCE_LABEL = "HAKA PRO Engine";
/** Readable names for dataset ids that reach the UI through the engine. */
const SOURCE_LABELS: Record<string, string> = { "idx-bei-api": "IDX-BEI (company snapshot)" };

/**
 * User-facing label for a provider/lane id. Engine lanes collapse to {@link ENGINE_SOURCE_LABEL};
 * fixture lanes (dev/test only) and any other value — real dataset names, "none" — pass through
 * unchanged. Only the displayed text changes; the stored `source` id that logic keys on is untouched.
 */
export function sourceLabel(source: string): string {
  return ENGINE_LANES.has(source) ? ENGINE_SOURCE_LABEL : SOURCE_LABELS[source] ?? source;
}

export { classifySessionDate, jakartaClock, marketPhase, previousTradingDay, isTradingDay } from "./session";

/** The freshness part of an envelope, as passed to data-bearing components. */
export type FreshnessMeta = Pick<WithFreshness<unknown>, "freshness" | "asOf" | "period" | "source">;

export function freshnessMeta(envelope: WithFreshness<unknown>): FreshnessMeta {
  return { freshness: envelope.freshness, asOf: envelope.asOf, period: envelope.period, source: envelope.source };
}

/** Order from freshest to least fresh. */
const RANK: Record<Freshness, number> = { LIVE: 0, DELAYED: 1, EOD: 2, HISTORICAL: 3, STALE: 4, UNAVAILABLE: 5 };

/** A combined view is only as fresh as its stalest part; with no parts it is UNAVAILABLE. */
export function leastFresh(states: Freshness[]): Freshness {
  return states.reduce<Freshness | null>((worst, state) => (worst === null || RANK[state] > RANK[worst] ? state : worst), null) ?? "UNAVAILABLE";
}
