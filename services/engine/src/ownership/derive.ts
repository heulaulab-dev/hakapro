// Derivations over stored snapshot sets: the HAKA-33 change engine against the previous month (adjacent months only)
// and the HAKA-34 free-float estimate (methodology DRAFT; stored, served only behind ENGINE_FREE_FLOAT_ENABLED).
import { compareOwnershipSnapshots } from "@/lib/ownership/changes";
import { estimateFreeFloat, type HolderSignals } from "@/lib/ownership/free-float";
import type { OwnershipSnapshot } from "@/lib/ownership/snapshot";
import { previousMonth } from "./numbers";
import type { ChangeRecord, OwnershipStore, StoredSet } from "./store";

/** Version of the change derivation stored on every ownership_changes row (DATA-ENGINE.md §6). */
export const CHANGE_DERIVATION = "haka33-compare@1";

/** A stored set as the HAKA-33 snapshot type (rows keep their line locator as `source.reference`). */
export function toSnapshot(set: StoredSet): OwnershipSnapshot {
  return {
    ticker: set.symbol,
    snapshotDate: set.snapshotDate,
    thresholdPercent: set.thresholdPercent,
    issuedShares: set.issuedShares,
    rows: set.rows.map((row) => ({
      ticker: set.symbol, holderKey: row.holderKey, holderName: row.holderName, holderKind: row.holderKind,
      shares: row.shares, percent: row.percent, snapshotDate: set.snapshotDate,
      source: { dataset: set.dataset, reference: row.sourceReference, retrievedAt: set.retrievedAt.toISOString() },
    })),
  };
}

/** Investor types as stated on the lines, the only signal the ≥1% list itself gives the methodology (§2). */
function signalsOf(set: StoredSet): Record<string, HolderSignals> {
  const signals: Record<string, HolderSignals> = {};
  for (const row of set.rows) if (row.investorType && !signals[row.holderKey]) signals[row.holderKey] = { investorType: row.investorType };
  return signals;
}

export function freeFloatDraft(set: StoredSet): Record<string, unknown> {
  const estimate = estimateFreeFloat(toSnapshot(set), { signals: signalsOf(set) });
  return {
    methodologyStatus: "draft",
    figureType: estimate.figureType,
    isOfficial: estimate.isOfficial,
    methodology: estimate.methodology,
    asOf: estimate.asOf,
    thresholdPercent: estimate.thresholdPercent,
    estimate: estimate.estimate,
    totals: estimate.totals,
    unavailableReason: estimate.unavailableReason,
    caveats: [...estimate.caveats],
    holders: estimate.holders.map((holder) => ({ holderKey: holder.holderKey, holderName: holder.holderName, percent: holder.percent, holderClass: holder.holderClass, rule: holder.rule })),
  };
}

/** Compares a symbol's set for `month` with the previous month's and stores the comparison, changes and estimate. */
export async function deriveSet(store: OwnershipStore, symbol: string, month: string): Promise<number> {
  const set = await store.getSet(symbol, month);
  if (!set) return 0;
  const previous = await store.previousSet(symbol, month);
  const base = { toDate: set.snapshotDate, counts: null, issuedShares: null, detail: null };
  let comparison: Record<string, unknown>;
  let changes: ChangeRecord[] = [];

  if (!previous) {
    comparison = { ...base, status: "NO_PREVIOUS", fromMonth: null, fromDate: null };
  } else if (previous.month !== previousMonth(month)) {
    comparison = { ...base, status: "NOT_ADJACENT", fromMonth: previous.month, fromDate: previous.snapshotDate, detail: `${previousMonth(month)} is not stored; the newest earlier month is ${previous.month}` };
  } else {
    const result = compareOwnershipSnapshots(toSnapshot(previous), toSnapshot(set));
    if (!result.ok) {
      comparison = { ...base, status: "REFUSED", fromMonth: previous.month, fromDate: previous.snapshotDate, detail: `${result.reason}: ${result.detail}` };
    } else {
      comparison = { ...base, status: "COMPARED", fromMonth: previous.month, fromDate: previous.snapshotDate, counts: result.counts, issuedShares: result.issuedShares };
      changes = result.changes.map((change) => ({
        toSetId: set.id, fromSetId: previous.id, symbol, month, fromDate: previous.snapshotDate, toDate: set.snapshotDate,
        holderKey: change.holderKey, holderName: change.holderName, holderKind: change.holderKind, kind: change.kind,
        sharesBefore: change.sharesBefore, sharesAfter: change.sharesAfter, shareDelta: change.shareDelta,
        percentBefore: change.percentBefore, percentAfter: change.percentAfter, ppDelta: change.ppDelta, flags: change.flags,
        fromReferences: change.fromSnapshot.rows.map((row) => row.source.reference),
        toReferences: change.toSnapshot.rows.map((row) => row.source.reference),
        derivation: CHANGE_DERIVATION,
      }));
    }
  }
  await store.saveDerivation(set.id, { comparison, freeFloat: freeFloatDraft(set), changes });
  return changes.length;
}

/** After `month` changed for `symbols`: re-derive that month and the symbol's next stored month (its "previous" changed). */
export async function deriveAfterUpload(store: OwnershipStore, symbols: string[], month: string): Promise<number> {
  let total = 0;
  for (const symbol of symbols) {
    total += await deriveSet(store, symbol, month);
    const next = await store.nextSet(symbol, month);
    if (next) await deriveSet(store, symbol, next.month);
  }
  return total;
}
