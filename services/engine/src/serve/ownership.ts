// Builds the ownership /v1 payloads (E6) from stored snapshot sets and changes. The HTTP layer validates them with the
// shared schemas (src/server/schemas/ownership.ts). Monthly position data is HISTORICAL, dated by its position date.
import type { z } from "zod";
import type { ownershipChangesSchema, ownershipUploadSchema, stockOwnershipSchema } from "@/server/schemas/ownership";
import { previousMonth } from "../ownership/numbers";
import type { OwnershipStore, SetHeader, UploadRecord } from "../ownership/store";
import type { Served } from "./market";

type StockOwnership = z.input<typeof stockOwnershipSchema>;
type OwnershipChanges = z.input<typeof ownershipChangesSchema>;

export function emptyStockOwnership(symbol: string): StockOwnership {
  return { symbol, issuerName: null, month: null, snapshotDate: null, thresholdPercent: null, issuedShares: null, source: null, holders: [], comparison: null, freeFloat: null };
}

const comparisonOf = (set: SetHeader) =>
  (set.comparison as StockOwnership["comparison"]) ?? { status: "NO_PREVIOUS" as const, fromMonth: null, fromDate: null, toDate: set.snapshotDate, counts: null, issuedShares: null, detail: null };

/** The symbol's newest stored month. The draft free-float estimate is included only when `freeFloatEnabled`. */
export async function serveStockOwnership(store: OwnershipStore, symbol: string, options: { freeFloatEnabled: boolean }): Promise<Served<StockOwnership> | null> {
  const set = await store.latestSet(symbol);
  if (!set) return null;
  return {
    data: {
      symbol: set.symbol, issuerName: set.issuerName, month: set.month, snapshotDate: set.snapshotDate,
      thresholdPercent: set.thresholdPercent, issuedShares: set.issuedShares,
      source: { dataset: set.dataset, reference: set.sourceReference, retrievedAt: set.retrievedAt.toISOString(), uploadId: set.uploadId },
      holders: [...set.rows].sort((a, b) => a.lineNo - b.lineNo).map((row) => ({
        holderKey: row.holderKey, holderName: row.holderName, holderKind: row.holderKind, shares: row.shares, percent: row.percent,
        investorType: row.investorType, localForeign: row.localForeign, reference: row.sourceReference,
      })),
      comparison: comparisonOf(set),
      freeFloat: options.freeFloatEnabled && set.freeFloat ? (set.freeFloat as StockOwnership["freeFloat"]) : null,
    },
    dataAsOf: set.snapshotDate,
    freshness: "HISTORICAL",
  };
}

/** Changes into `month` (per holder) and each issuer's comparison status; null when the month has no stored list. */
export async function serveOwnershipChanges(store: OwnershipStore, month: string, symbol?: string): Promise<Served<OwnershipChanges> | null> {
  const sets = await store.setsInMonth(month, symbol);
  if (!sets.length) return null;
  const changes = await store.changes(month, symbol);
  return {
    data: {
      month,
      previousMonth: previousMonth(month),
      comparisons: sets.map((set) => ({ symbol: set.symbol, ...comparisonOf(set) })),
      changes: changes.map((change) => ({
        symbol: change.symbol, holderKey: change.holderKey, holderName: change.holderName, holderKind: change.holderKind, kind: change.kind,
        sharesBefore: change.sharesBefore, sharesAfter: change.sharesAfter, shareDelta: change.shareDelta,
        percentBefore: change.percentBefore, percentAfter: change.percentAfter, ppDelta: change.ppDelta, flags: change.flags,
        fromDate: change.fromDate, toDate: change.toDate, fromReferences: change.fromReferences, toReferences: change.toReferences,
      })),
    },
    dataAsOf: sets.map((set) => set.snapshotDate).sort().at(-1)!,
    freshness: "HISTORICAL",
  };
}

export function uploadView(upload: UploadRecord): z.input<typeof ownershipUploadSchema> {
  return {
    id: upload.id, receivedAt: upload.receivedAt.toISOString(), asOfMonth: upload.asOfMonth, snapshotDate: upload.snapshotDate,
    sourceLabel: upload.sourceLabel, fileName: upload.fileName, format: upload.format, contentType: upload.contentType, byteSize: upload.byteSize,
    sha256: upload.sha256, status: upload.status, error: upload.error, issues: upload.issues,
    stats: upload.stats as Record<string, unknown> | null, parsedAt: upload.parsedAt?.toISOString() ?? null,
  };
}
