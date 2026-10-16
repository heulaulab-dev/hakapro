/**
 * Strategy Engine contract (HAKA-18): the only strategy shapes the BFF serves and the UI reads,
 * whichever engine produced them. Adapters (src/server/strategies) map each source into it.
 *
 * Reasons and metrics are observations, never recommendations (MIGRATION §9.5): no provider win
 * rate, "potensi", drawdown or direction arrows, and no score derived from them.
 */
import { z } from "zod";
import { FRESHNESS_STATES } from "@/lib/freshness";
import { formatQuantity, QUANTITY_UNITS, type Locale } from "@/lib/format";

export const STRATEGY_SOURCES = ["ARJUM_SCREENER", "HAKAPRO_EOD_ENGINE", "HAKAPRO_REALTIME_ENGINE"] as const;
export type StrategySourceId = (typeof STRATEGY_SOURCES)[number];

export const STRATEGY_KINDS = ["EOD", "REALTIME"] as const;
export type StrategyKind = (typeof STRATEGY_KINDS)[number];

/** Observed criteria, worded by HAKAPRO (i18n `criteria.<key>`), never by the source. */
export const CRITERION_KEYS = [
  "accumulation", "distribution", "brokerConcentration", "institutional", "foreignBuying", "strongTechnicals",
  "quietAccumulation", "historicalEdge", "historicalTrap", "pumpRisk", "lateEntry", "climax",
] as const;
export type CriterionKey = (typeof CRITERION_KEYS)[number];

const freshness = z.enum(FRESHNESS_STATES);
const source = z.enum(STRATEGY_SOURCES);
/** ISO date or timestamp of the underlying data; null when the source's date can't be read. */
const isoDate = z.string().nullable();

/**
 * Why a candidate matched:
 * - `criterion`: a recognized observation;
 * - `unrecognized`: a reason the source emitted that HAKAPRO can't word yet — shown, never dropped;
 * - `pattern` / `note`: the source's own descriptive text, forward-looking stats already stripped.
 */
export const reasonSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("criterion"), key: z.enum(CRITERION_KEYS) }),
  z.object({ kind: z.literal("unrecognized"), code: z.string(), label: z.string().nullable() }),
  z.object({ kind: z.literal("pattern"), text: z.string() }),
  z.object({ kind: z.literal("note"), text: z.string() }),
]);
export type Reason = z.infer<typeof reasonSchema>;
export type CriterionReason = Extract<Reason, { kind: "criterion" | "unrecognized" }>;

/** A measured value with its unit. A missing value is null (rendered unavailable), never 0. */
export const metricSchema = z.object({ key: z.string(), value: z.number().nullable(), unit: z.enum(QUANTITY_UNITS) });
export type Metric = z.infer<typeof metricSchema>;

export const screenerStrategySchema = z.object({
  /** Slug, unique across sources (`/discover/strategies/[id]`). */
  id: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  source,
  kind: z.enum(STRATEGY_KINDS),
  dataAsOf: isoDate,
  freshness,
});
export type ScreenerStrategy = z.infer<typeof screenerStrategySchema>;

export const screenerCandidateSchema = z.object({
  symbol: z.string(),
  /** Company name as the source reported it. */
  name: z.string().nullable(),
  strategyId: z.string(),
  /** When the strategy flagged the stock; a source that doesn't timestamp rows uses its run date. */
  detectedAt: isoDate,
  dataAsOf: isoDate,
  freshness,
  /** The engine's own score, if it computes one. Never derived from provider win rates. */
  score: z.number().nullable(),
  reasons: z.array(reasonSchema),
  metrics: z.array(metricSchema),
  source,
});
export type ScreenerCandidate = z.infer<typeof screenerCandidateSchema>;

/** Run-level facts a source states about its screen: version, market condition, universe covered. */
export const screenerContextSchema = z.object({
  source,
  version: z.string().nullable(),
  marketCondition: z.object({ label: z.string(), averageChangePercent: z.number().nullable() }).nullable(),
  universe: z.object({ covered: z.number(), liquid: z.number(), skipped: z.number() }).nullable(),
});
export type ScreenerContext = z.infer<typeof screenerContextSchema>;

/** `/api/strategies` payload: every registered source's strategies and candidates. */
export const strategyBoardSchema = z.object({
  contexts: z.array(screenerContextSchema),
  strategies: z.array(screenerStrategySchema),
  candidates: z.array(screenerCandidateSchema),
});
export type StrategyBoard = z.infer<typeof strategyBoardSchema>;

/** A strategy's candidates, in the source's order. */
export function candidatesFor(board: StrategyBoard, strategyId: string): ScreenerCandidate[] {
  return board.candidates.filter((candidate) => candidate.strategyId === strategyId);
}

export function criteriaOf(reasons: Reason[]): CriterionReason[] {
  return reasons.filter((reason): reason is CriterionReason => reason.kind === "criterion" || reason.kind === "unrecognized");
}

export function textsOf(reasons: Reason[], kind: "pattern" | "note"): string[] {
  return reasons.flatMap((reason) => (reason.kind === kind ? [reason.text] : []));
}

/** Display value for a metric; a missing value reads "—" (unavailable), never "0". */
export function formatMetric(metric: Metric, locale: Locale): string {
  return formatQuantity(metric.value, metric.unit, locale);
}
