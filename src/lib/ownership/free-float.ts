/**
 * Estimated free float, HAKAPRO methodology v0.1 (DRAFT, awaiting owner approval). Plane HAKA-34.
 * The rules are specified in docs/features/FREE-FLOAT-METHODOLOGY.md; this function is their only implementation, and
 * every output carries the methodology version.
 *
 * An estimate is never official. The result type pins `figureType: "ESTIMATE"` and `isOfficial: false`; an official or
 * regulatory figure, when one is supplied, travels separately in `official` and is never mixed into the estimate.
 */
import { z } from "zod";
import { HUNDRED_PERCENT_MICRO, canonicalPercent, microToPercent, percentToMicro } from "./decimal";
import { distinctSources, ownershipSnapshotSchema, ownershipSourceSchema, percentSchema, type OwnershipHolderKind, type OwnershipSnapshot, type OwnershipSnapshotRow, type OwnershipSource } from "./snapshot";

export const FREE_FLOAT_METHODOLOGY = {
  id: "hakapro-free-float",
  version: "0.1-draft",
  status: "DRAFT_AWAITING_OWNER_APPROVAL",
  label: "Estimated free float (HAKAPRO methodology v0.1)",
} as const;

export const HOLDER_CLASSES = ["strategic", "portfolio", "unknown"] as const;
export type HolderClass = (typeof HOLDER_CLASSES)[number];

/** Classification rules, in the order they are tried (first match wins). Documented one by one in the methodology. */
export const CLASSIFICATION_RULES = [
  "OVERRIDE",
  "TREASURY",
  "GOVERNMENT",
  "CONTROLLER_OR_BOARD",
  "AFFILIATE",
  "NOMINEE_ACCOUNT",
  "AT_OR_ABOVE_5_PERCENT",
  "FUND_INVESTOR_TYPE",
  "DEFAULT_UNKNOWN",
] as const;
export type ClassificationRule = (typeof CLASSIFICATION_RULES)[number];

/** Strategic threshold for a single disclosed holding, in micro-percent (5 %). */
const STRATEGIC_PERCENT_MICRO = 5_000_000;
/** Investor-type codes treated as portfolio investors below 5 %: mutual fund, pension fund, insurance. */
export const PORTFOLIO_INVESTOR_TYPES = ["MF", "PF", "IS"] as const;

/** Disclosed facts about a holder from other sources (each must be dated and sourced where it is shown). */
export type HolderSignals = {
  /** Disclosed as controlling shareholder (pengendali). */
  controller?: boolean;
  /** Disclosed as a director or commissioner of the issuer. */
  boardMember?: boolean;
  /** Disclosed as an affiliate of the issuer or its controller. */
  affiliate?: boolean;
  /** The issuer's own repurchased (treasury) shares. */
  treasury?: boolean;
  /** Investor-type code as stated by the source (e.g. KSEI "MF"). Never guessed from the name. */
  investorType?: string;
};

/** A curated, owner-approved decision for one holder key. Reason and reference are mandatory. */
export type ClassificationOverride = { holderClass: HolderClass; reason: string; reference: string };

export const officialFreeFloatSchema = z.object({
  figureType: z.literal("OFFICIAL"),
  /** Who published it (e.g. the exchange). */
  publisher: z.string().trim().min(1),
  percent: percentSchema,
  asOf: z.iso.date(),
  source: ownershipSourceSchema,
});
export type OfficialFreeFloat = z.infer<typeof officialFreeFloatSchema>;

export type ClassifiedHolder = {
  holderKey: string;
  holderName: string;
  holderKind: OwnershipHolderKind;
  percent: string | null;
  holderClass: HolderClass;
  rule: ClassificationRule;
  /** Present when rule is OVERRIDE. */
  override?: { reason: string; reference: string };
  source: OwnershipSource;
};

/** What ≥1 % data cannot show. Always attached, so a UI can't drop the caveats silently. */
export const FREE_FLOAT_CAVEATS = [
  "BELOW_THRESHOLD_HOLDERS_UNSEEN",
  "NOMINEE_BENEFICIAL_OWNERS_UNKNOWN",
  "CONCERT_PARTIES_NOT_AGGREGATED",
  "TREASURY_ONLY_IF_SIGNALLED",
  "LOCKUPS_AND_PLEDGES_NOT_VISIBLE",
] as const;
export type FreeFloatCaveat = (typeof FREE_FLOAT_CAVEATS)[number];

export type FreeFloatUnavailableReason = "NO_DISCLOSED_ROWS" | "MISSING_PERCENT" | "DISCLOSED_EXCEEDS_100";

export type FreeFloatEstimate = {
  figureType: "ESTIMATE";
  isOfficial: false;
  methodology: typeof FREE_FLOAT_METHODOLOGY;
  ticker: string;
  /** Position date of the snapshot the estimate is computed from. */
  asOf: string;
  thresholdPercent: string;
  sources: OwnershipSource[];
  holders: ClassifiedHolder[];
  /** Aggregate lines ("Masyarakat"), not holders: listed, never classified or counted. */
  excludedAggregates: OwnershipSnapshotRow[];
  /** Exact duplicate rows (same key, values and source reference) counted once. */
  duplicateRowsCollapsed: number;
  /** Six-decimal percentage strings. Null when the estimate is unavailable. */
  totals: { disclosed: string; strategic: string; portfolio: string; unknown: string; undisclosed: string } | null;
  /**
   * low = 100 − strategic − unknown (unknown counted as not free; the headline figure).
   * high = 100 − strategic (unknown counted as free). The truth can lie outside this range: see `caveats`.
   */
  estimate: { headline: string; low: string; high: string } | null;
  unavailableReason: FreeFloatUnavailableReason | null;
  caveats: readonly FreeFloatCaveat[];
  /** An official/regulatory figure, if supplied, untouched and separate. Never derived from the estimate. */
  official: OfficialFreeFloat | null;
};

export type EstimateOptions = {
  signals?: Record<string, HolderSignals>;
  overrides?: Record<string, ClassificationOverride>;
  official?: OfficialFreeFloat | null;
};

/** Classifies one disclosed holder line. `public` aggregates must be filtered out before (they are not holders). */
export function classifyHolder(
  row: Pick<OwnershipSnapshotRow, "holderKind" | "percent">,
  signals: HolderSignals = {},
  override?: ClassificationOverride,
): { holderClass: HolderClass; rule: ClassificationRule } {
  if (override) return { holderClass: override.holderClass, rule: "OVERRIDE" };
  if (signals.treasury) return { holderClass: "strategic", rule: "TREASURY" };
  if (row.holderKind === "government") return { holderClass: "strategic", rule: "GOVERNMENT" };
  if (signals.controller || signals.boardMember) return { holderClass: "strategic", rule: "CONTROLLER_OR_BOARD" };
  if (signals.affiliate) return { holderClass: "strategic", rule: "AFFILIATE" };
  // The registered holder is not the owner; the beneficial owner could be anyone, including a controller.
  if (row.holderKind === "custodian_nominee") return { holderClass: "unknown", rule: "NOMINEE_ACCOUNT" };
  if (row.percent !== null && percentToMicro(row.percent) >= STRATEGIC_PERCENT_MICRO) return { holderClass: "strategic", rule: "AT_OR_ABOVE_5_PERCENT" };
  const investorType = signals.investorType?.trim().toUpperCase();
  if (investorType && (PORTFOLIO_INVESTOR_TYPES as readonly string[]).includes(investorType)) return { holderClass: "portfolio", rule: "FUND_INVESTOR_TYPE" };
  return { holderClass: "unknown", rule: "DEFAULT_UNKNOWN" };
}

const rowIdentity = (row: OwnershipSnapshotRow) =>
  JSON.stringify([row.holderKey, row.shares, row.percent === null ? null : percentToMicro(row.percent), row.source.dataset, row.source.reference]);

/** Estimates free float for one ticker at one position date from its disclosed holders. Pure; versioned output. */
export function estimateFreeFloat(snapshotInput: OwnershipSnapshot, options: EstimateOptions = {}): FreeFloatEstimate {
  const snapshot = ownershipSnapshotSchema.parse(snapshotInput);
  const official = options.official ? officialFreeFloatSchema.parse(options.official) : null;

  const excludedAggregates = snapshot.rows.filter((row) => row.holderKind === "public");
  const seen = new Set<string>();
  const holderRows: OwnershipSnapshotRow[] = [];
  for (const row of snapshot.rows) {
    if (row.holderKind === "public") continue;
    const identity = rowIdentity(row);
    if (seen.has(identity)) continue;
    seen.add(identity);
    holderRows.push(row);
  }

  const holders: ClassifiedHolder[] = holderRows.map((row) => {
    const override = options.overrides?.[row.holderKey];
    const { holderClass, rule } = classifyHolder(row, options.signals?.[row.holderKey], override);
    return {
      holderKey: row.holderKey,
      holderName: row.holderName,
      holderKind: row.holderKind,
      percent: row.percent === null ? null : canonicalPercent(row.percent),
      holderClass,
      rule,
      ...(override ? { override: { reason: override.reason, reference: override.reference } } : {}),
      source: row.source,
    };
  });

  const base = {
    figureType: "ESTIMATE" as const,
    isOfficial: false as const,
    methodology: FREE_FLOAT_METHODOLOGY,
    ticker: snapshot.ticker,
    asOf: snapshot.snapshotDate,
    thresholdPercent: canonicalPercent(snapshot.thresholdPercent),
    sources: distinctSources(snapshot.rows),
    holders,
    excludedAggregates,
    duplicateRowsCollapsed: snapshot.rows.length - excludedAggregates.length - holderRows.length,
    caveats: FREE_FLOAT_CAVEATS,
    official,
  };
  const unavailable = (reason: FreeFloatUnavailableReason): FreeFloatEstimate => ({ ...base, totals: null, estimate: null, unavailableReason: reason });

  if (holders.length === 0) return unavailable("NO_DISCLOSED_ROWS");
  if (holders.some((holder) => holder.percent === null)) return unavailable("MISSING_PERCENT");

  const sum = { strategic: 0, portfolio: 0, unknown: 0 } satisfies Record<HolderClass, number>;
  for (const holder of holders) sum[holder.holderClass] += percentToMicro(holder.percent!);
  const disclosed = sum.strategic + sum.portfolio + sum.unknown;
  if (disclosed > HUNDRED_PERCENT_MICRO) return unavailable("DISCLOSED_EXCEEDS_100");

  const low = HUNDRED_PERCENT_MICRO - sum.strategic - sum.unknown;
  const high = HUNDRED_PERCENT_MICRO - sum.strategic;
  return {
    ...base,
    totals: {
      disclosed: microToPercent(disclosed),
      strategic: microToPercent(sum.strategic),
      portfolio: microToPercent(sum.portfolio),
      unknown: microToPercent(sum.unknown),
      undisclosed: microToPercent(HUNDRED_PERCENT_MICRO - disclosed),
    },
    estimate: { headline: microToPercent(low), low: microToPercent(low), high: microToPercent(high) },
    unavailableReason: null,
  };
}
