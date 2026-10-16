/**
 * Month-over-month ownership change engine (Plane HAKA-33). Pure: compares two snapshots of one ticker and reports,
 * per holder, what the disclosures say changed. It never infers intent, identity or trades.
 *
 * Statuses:
 * - NEW: in the later snapshot, not in the earlier one. With a threshold list (≥1 %) this means "newly disclosed at or
 *   above the threshold": the earlier holding is unknown (below the threshold or nil), so before-values and deltas are null.
 * - INCREASE / DECREASE / UNCHANGED: in both; decided on shares when both months state shares, otherwise on percent.
 * - EXIT: a stated zero (a row with 0 shares, or absence from a complete register, threshold 0). Never inferred from a
 *   threshold list.
 * - BELOW_THRESHOLD: in the earlier snapshot, missing from a later threshold list. The holder may have sold out or may
 *   still hold less than the threshold; the data can't tell, so this is never reported as EXIT.
 * - AMBIGUOUS: one month has conflicting rows for the same holder key, or neither shares nor percent can be compared.
 *   Every row is kept; no value is picked.
 *
 * Corporate actions: when shares are unchanged but the percentage moved (issuance, buyback, rounding), the status is
 * UNCHANGED with the flag PERCENT_CHANGED_SHARES_UNCHANGED. When both snapshots state issued shares and they differ,
 * every holder present in both carries ISSUED_SHARES_CHANGED, so a split or rights issue isn't read as buying.
 */
import { canonicalPercent, microToPercent, parseShares, percentToMicro } from "./decimal";
import { distinctSources, ownershipSnapshotSchema, type OwnershipHolderKind, type OwnershipSnapshot, type OwnershipSnapshotRow, type OwnershipSource } from "./snapshot";

export const OWNERSHIP_CHANGE_KINDS = ["NEW", "INCREASE", "DECREASE", "EXIT", "UNCHANGED", "BELOW_THRESHOLD", "AMBIGUOUS"] as const;
export type OwnershipChangeKind = (typeof OWNERSHIP_CHANGE_KINDS)[number];

export const OWNERSHIP_CHANGE_FLAGS = [
  /** NEW from a threshold list: the earlier holding was below the threshold or nil, not known which. */
  "PRIOR_HOLDING_UNKNOWN",
  /** Shares identical, percentage moved: issued shares changed (corporate action) or the source rounded differently. */
  "PERCENT_CHANGED_SHARES_UNCHANGED",
  /** Shares and percentage moved in opposite directions, e.g. buying less than pro rata in a rights issue. */
  "SHARES_AND_PERCENT_DIVERGE",
  /** Both snapshots state issued shares and they differ. */
  "ISSUED_SHARES_CHANGED",
  /** Several rows with the same key and identical values in one month were counted once. */
  "DUPLICATE_ROWS_COLLAPSED",
  /** Several rows with the same key and different values in one month (status AMBIGUOUS). */
  "CONFLICTING_DUPLICATE_ROWS",
  /** Shares missing on at least one side; the status was decided on percentage. */
  "COMPARED_BY_PERCENT",
  /** Neither shares nor percent are stated on both sides (status AMBIGUOUS). */
  "NO_COMPARABLE_VALUES",
  /** Same key, different disclosed name (e.g. legal-form variant). Both names are in the row references. */
  "HOLDER_NAME_CHANGED",
  "HOLDER_KIND_CHANGED",
  /** An aggregate line such as "Masyarakat", not a holder. */
  "AGGREGATE_ROW",
] as const;
export type OwnershipChangeFlag = (typeof OWNERSHIP_CHANGE_FLAGS)[number];

/** A holder's lines in one snapshot, verbatim with their source references. Empty when the holder is absent. */
export type HolderSnapshotRef = { snapshotDate: string; present: boolean; rows: OwnershipSnapshotRow[] };

export type OwnershipChange = {
  ticker: string;
  holderKey: string;
  /** Latest disclosed name and kind (the later month when present). Every raw name stays in the refs. */
  holderName: string;
  holderKind: OwnershipHolderKind;
  kind: OwnershipChangeKind;
  /** Integer strings. Null when not stated or not knowable (absence from a threshold list). */
  sharesBefore: string | null;
  sharesAfter: string | null;
  shareDelta: string | null;
  /** Six-decimal strings. ppDelta is in percentage points, exact for the precision the source published. */
  percentBefore: string | null;
  percentAfter: string | null;
  ppDelta: string | null;
  flags: OwnershipChangeFlag[];
  fromSnapshot: HolderSnapshotRef;
  toSnapshot: HolderSnapshotRef;
};

export type SnapshotSummary = {
  ticker: string;
  snapshotDate: string;
  thresholdPercent: string;
  issuedShares: string | null;
  /** Every distinct source the snapshot's rows came from. Absence is relative to these. */
  sources: OwnershipSource[];
};

export type ComparisonRefusalReason = "TICKER_MISMATCH" | "NOT_CHRONOLOGICAL" | "SAME_MONTH" | "NON_ADJACENT_MONTHS";

export type OwnershipComparison =
  | { ok: false; reason: ComparisonRefusalReason; detail: string }
  | {
      ok: true;
      ticker: string;
      from: SnapshotSummary;
      to: SnapshotSummary;
      /** Calendar months between the two position dates; 1 for adjacent months. */
      monthsApart: number;
      adjacent: boolean;
      issuedShares: { before: string; after: string; delta: string } | null;
      changes: OwnershipChange[];
      counts: Record<OwnershipChangeKind, number>;
    };

export type CompareOptions = {
  /** Compare snapshots more than one month apart. The result is marked `adjacent: false`. Default: refuse. */
  allowNonAdjacent?: boolean;
};

type HolderState =
  | { state: "absent" }
  | { state: "conflict" }
  | { state: "stated"; shares: bigint | null; percent: number | null; collapsed: boolean };

function monthIndex(isoDate: string): number {
  return Number(isoDate.slice(0, 4)) * 12 + Number(isoDate.slice(5, 7)) - 1;
}

function summary(snapshot: OwnershipSnapshot): SnapshotSummary {
  return {
    ticker: snapshot.ticker,
    snapshotDate: snapshot.snapshotDate,
    thresholdPercent: canonicalPercent(snapshot.thresholdPercent),
    issuedShares: snapshot.issuedShares,
    sources: distinctSources(snapshot.rows),
  };
}

function groupRows(snapshot: OwnershipSnapshot): Map<string, OwnershipSnapshotRow[]> {
  const groups = new Map<string, OwnershipSnapshotRow[]>();
  for (const row of snapshot.rows) groups.set(row.holderKey, [...(groups.get(row.holderKey) ?? []), row]);
  return groups;
}

function stateOf(rows: OwnershipSnapshotRow[]): HolderState {
  if (rows.length === 0) return { state: "absent" };
  const values = new Set(rows.map((row) => `${row.shares === null ? "-" : parseShares(row.shares)}|${row.percent === null ? "-" : percentToMicro(row.percent)}`));
  if (values.size > 1) return { state: "conflict" };
  const [first] = rows;
  return {
    state: "stated",
    shares: first.shares === null ? null : parseShares(first.shares),
    percent: first.percent === null ? null : percentToMicro(first.percent),
    collapsed: rows.length > 1,
  };
}

const sign = (value: bigint | number) => (value > 0 ? 1 : value < 0 ? -1 : 0);

/**
 * Compares two snapshots of one ticker, `from` being the earlier month. Refuses (ok: false) on a ticker mismatch,
 * wrong order, two snapshots in the same month, or months that aren't adjacent unless `allowNonAdjacent` is set.
 * Throws only on malformed input (schema validation).
 */
export function compareOwnershipSnapshots(fromInput: OwnershipSnapshot, toInput: OwnershipSnapshot, options: CompareOptions = {}): OwnershipComparison {
  const from = ownershipSnapshotSchema.parse(fromInput);
  const to = ownershipSnapshotSchema.parse(toInput);

  if (from.ticker !== to.ticker) return { ok: false, reason: "TICKER_MISMATCH", detail: `${from.ticker} vs ${to.ticker}` };
  if (from.snapshotDate >= to.snapshotDate) return { ok: false, reason: "NOT_CHRONOLOGICAL", detail: `${from.snapshotDate} is not before ${to.snapshotDate}` };
  const monthsApart = monthIndex(to.snapshotDate) - monthIndex(from.snapshotDate);
  if (monthsApart === 0) return { ok: false, reason: "SAME_MONTH", detail: `${from.snapshotDate} and ${to.snapshotDate} are in the same month` };
  if (monthsApart > 1 && !options.allowNonAdjacent) {
    return { ok: false, reason: "NON_ADJACENT_MONTHS", detail: `${from.snapshotDate} → ${to.snapshotDate} is ${monthsApart} months apart` };
  }

  const fromThreshold = percentToMicro(from.thresholdPercent);
  const toThreshold = percentToMicro(to.thresholdPercent);
  const issuedShares =
    from.issuedShares !== null && to.issuedShares !== null && parseShares(from.issuedShares) !== parseShares(to.issuedShares)
      ? { before: from.issuedShares, after: to.issuedShares, delta: (parseShares(to.issuedShares) - parseShares(from.issuedShares)).toString() }
      : null;

  const before = groupRows(from);
  const after = groupRows(to);
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();

  const changes = keys.map((holderKey): OwnershipChange => {
    const beforeRows = before.get(holderKey) ?? [];
    const afterRows = after.get(holderKey) ?? [];
    const latest = (afterRows[0] ?? beforeRows[0])!;
    const b = stateOf(beforeRows);
    const a = stateOf(afterRows);
    const flags = new Set<OwnershipChangeFlag>();

    const allRows = [...beforeRows, ...afterRows];
    if (new Set(allRows.map((row) => row.holderName.trim())).size > 1) flags.add("HOLDER_NAME_CHANGED");
    if (new Set(allRows.map((row) => row.holderKind)).size > 1) flags.add("HOLDER_KIND_CHANGED");
    if (allRows.some((row) => row.holderKind === "public")) flags.add("AGGREGATE_ROW");
    if ((b.state === "stated" && b.collapsed) || (a.state === "stated" && a.collapsed)) flags.add("DUPLICATE_ROWS_COLLAPSED");

    const result: OwnershipChange = {
      ticker: from.ticker,
      holderKey,
      holderName: latest.holderName,
      holderKind: latest.holderKind,
      kind: "AMBIGUOUS",
      sharesBefore: null,
      sharesAfter: null,
      shareDelta: null,
      percentBefore: null,
      percentAfter: null,
      ppDelta: null,
      flags: [],
      fromSnapshot: { snapshotDate: from.snapshotDate, present: beforeRows.length > 0, rows: beforeRows },
      toSnapshot: { snapshotDate: to.snapshotDate, present: afterRows.length > 0, rows: afterRows },
    };
    const finish = (kind: OwnershipChangeKind): OwnershipChange => ({ ...result, kind, flags: OWNERSHIP_CHANGE_FLAGS.filter((flag) => flags.has(flag)) });

    if (b.state === "conflict" || a.state === "conflict") {
      flags.add("CONFLICTING_DUPLICATE_ROWS");
      return finish("AMBIGUOUS");
    }

    // Absence from a complete register (threshold 0) is a stated nil; absence from a threshold list is unknown.
    const resolve = (state: HolderState, threshold: number) =>
      state.state === "stated" ? state : threshold === 0 ? { shares: BigInt(0), percent: 0 } : null;
    const bv = resolve(b, fromThreshold);
    const av = resolve(a, toThreshold);

    if (bv) {
      result.sharesBefore = bv.shares === null ? null : bv.shares.toString();
      result.percentBefore = bv.percent === null ? null : microToPercent(bv.percent);
    }
    if (av) {
      result.sharesAfter = av.shares === null ? null : av.shares.toString();
      result.percentAfter = av.percent === null ? null : microToPercent(av.percent);
    }

    // Only absence from a threshold list leaves a side unresolved (a holder key is always present on one side).
    if (!bv) {
      flags.add("PRIOR_HOLDING_UNKNOWN");
      return finish("NEW");
    }
    if (!av) return finish("BELOW_THRESHOLD");

    if (issuedShares && b.state === "stated" && a.state === "stated") flags.add("ISSUED_SHARES_CHANGED");

    const shareDelta = bv.shares !== null && av.shares !== null ? av.shares - bv.shares : null;
    const ppDelta = bv.percent !== null && av.percent !== null ? av.percent - bv.percent : null;
    if (shareDelta !== null) result.shareDelta = shareDelta.toString();
    if (ppDelta !== null) result.ppDelta = microToPercent(ppDelta);

    if (shareDelta !== null && ppDelta !== null) {
      if (shareDelta === BigInt(0) && ppDelta !== 0) flags.add("PERCENT_CHANGED_SHARES_UNCHANGED");
      if (sign(shareDelta) * sign(ppDelta) < 0) flags.add("SHARES_AND_PERCENT_DIVERGE");
    }

    let direction: number;
    let isZeroBefore: boolean;
    let isZeroAfter: boolean;
    if (shareDelta !== null) {
      direction = sign(shareDelta);
      isZeroBefore = bv.shares === BigInt(0);
      isZeroAfter = av.shares === BigInt(0);
    } else if (ppDelta !== null) {
      flags.add("COMPARED_BY_PERCENT");
      direction = sign(ppDelta);
      isZeroBefore = bv.percent === 0;
      isZeroAfter = av.percent === 0;
    } else {
      flags.add("NO_COMPARABLE_VALUES");
      return finish("AMBIGUOUS");
    }

    if (isZeroBefore && !isZeroAfter) return finish("NEW");
    if (!isZeroBefore && isZeroAfter) return finish("EXIT");
    return finish(direction > 0 ? "INCREASE" : direction < 0 ? "DECREASE" : "UNCHANGED");
  });

  const counts = Object.fromEntries(OWNERSHIP_CHANGE_KINDS.map((kind) => [kind, 0])) as Record<OwnershipChangeKind, number>;
  for (const change of changes) counts[change.kind] += 1;

  return {
    ok: true,
    ticker: from.ticker,
    from: summary(from),
    to: summary(to),
    monthsApart,
    adjacent: monthsApart === 1,
    issuedShares,
    changes,
    counts,
  };
}
