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
  return { symbol, issuerName: null, month: null, snapshotDate: null, thresholdPercent: null, issuedShares: null, source: null, holders: [], crossHoldings: [], network: null, comparison: null, freeFloat: null };
}

// Conservative exact matching against the issuer names in this same KSEI snapshot. Legal-form punctuation is
// normalized, but fuzzy/partial matching is intentionally not used; ambiguous normalized issuer names are rejected.
const issuerKey = (name: string | null) => name?.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").replace(/\b(PT|TBK|PERSERO)\b/g, " ").replace(/\s+/g, " ").trim() ?? "";

export async function crossHoldingsFor(store: OwnershipStore, symbol: string, month: string): Promise<StockOwnership["crossHoldings"]> {
  const sets = await store.setsWithRowsInMonth(month);
  const issuers = new Map<string, SetHeader | null>();
  for (const set of sets) {
    const key = issuerKey(set.issuerName);
    if (!key) continue;
    if (!issuers.has(key)) issuers.set(key, set);
    else issuers.set(key, null);
  }
  const directed = new Map<string, { owner: SetHeader; held: SetHeader; shares: string | null; percent: string | null; reference: string }>();
  const ambiguousDirections = new Set<string>();
  for (const set of sets) {
    for (const row of set.rows) {
      if (row.holderKind !== "organisation") continue;
      const owner = issuers.get(issuerKey(row.holderName));
      if (!owner || owner.symbol === set.symbol) continue;
      const key = `${owner.symbol}:${set.symbol}`;
      if (ambiguousDirections.has(key)) continue;
      if (directed.has(key)) {
        // Never silently choose or sum duplicate lines for the same listed issuer pair.
        directed.delete(key);
        ambiguousDirections.add(key);
        continue;
      }
      directed.set(key, { owner, held: set, shares: row.shares, percent: row.percent, reference: row.sourceReference });
    }
  }
  const edges: StockOwnership["crossHoldings"] = [];
  for (const edge of directed.values()) {
    const reverse = directed.get(`${edge.held.symbol}:${edge.owner.symbol}`);
    if (!reverse || (edge.owner.symbol !== symbol && edge.held.symbol !== symbol) || edge.owner.symbol > edge.held.symbol) continue;
    if (edge.owner.month !== edge.held.month || edge.owner.snapshotDate !== edge.held.snapshotDate ||
        reverse.owner.snapshotDate !== edge.owner.snapshotDate || reverse.held.snapshotDate !== edge.held.snapshotDate) continue;
    edges.push({
      ownerSymbol: edge.owner.symbol, ownerName: edge.owner.issuerName ?? edge.owner.symbol,
      heldSymbol: edge.held.symbol, heldName: edge.held.issuerName ?? edge.held.symbol,
      shares: edge.shares, percent: edge.percent, reciprocalShares: reverse.shares, reciprocalPercent: reverse.percent,
      snapshotDate: edge.held.snapshotDate, sourceReference: edge.reference, reciprocalSourceReference: reverse.reference,
    });
  }
  return edges.sort((a, b) => a.ownerSymbol.localeCompare(b.ownerSymbol) || a.heldSymbol.localeCompare(b.heldSymbol));
}

export async function ownershipNetworkFor(store: OwnershipStore, month: string): Promise<NonNullable<StockOwnership["network"]>> {
  const sets = await store.setsWithRowsInMonth(month);
  const issuers = new Map<string, SetHeader>();
  const nodes = new Map<string, { id: string; label: string; kind: "issuer" | "holder" }>();
  const ambiguous = new Set<string>();
  for (const set of sets) {
    nodes.set(`issuer:${set.symbol}`, { id: `issuer:${set.symbol}`, label: set.issuerName ?? set.symbol, kind: "issuer" });
    const key = issuerKey(set.issuerName);
    if (!key) continue;
    if (issuers.has(key)) { ambiguous.add(key); issuers.delete(key); } else if (!ambiguous.has(key)) issuers.set(key, set);
  }
  const edges: NonNullable<StockOwnership["network"]>["edges"] = [];
  for (const set of sets) {
    for (const row of set.rows) {
      if (row.holderKind !== "organisation") continue;
      const held = issuers.get(issuerKey(row.holderName));
      if (!held || held.symbol === set.symbol) continue;
      nodes.set(`holder:${row.holderKey}`, { id: `holder:${row.holderKey}`, label: row.holderName, kind: "holder" });
      edges.push({ from: `holder:${row.holderKey}`, to: `issuer:${set.symbol}`, percent: row.percent, shares: row.shares, month, sourceReference: row.sourceReference, confidence: "exact" });
    }
  }
  return { nodes: [...nodes.values()], edges, ambiguous: ambiguous.size };
}

const comparisonOf = (set: SetHeader) =>
  (set.comparison as StockOwnership["comparison"]) ?? { status: "NO_PREVIOUS" as const, fromMonth: null, fromDate: null, toDate: set.snapshotDate, counts: null, issuedShares: null, detail: null };

/** The symbol's newest stored month. The draft free-float estimate is included only when `freeFloatEnabled`. */
export async function serveStockOwnership(store: OwnershipStore, symbol: string, options: { freeFloatEnabled: boolean; ownershipNetworkEnabled?: boolean }): Promise<Served<StockOwnership> | null> {
  const set = await store.latestSet(symbol);
  if (!set) return null;
  const crossHoldings = await crossHoldingsFor(store, symbol, set.month);
  const network = options.ownershipNetworkEnabled ? await ownershipNetworkFor(store, set.month) : null;
  return {
    data: {
      symbol: set.symbol, issuerName: set.issuerName, month: set.month, snapshotDate: set.snapshotDate,
      thresholdPercent: set.thresholdPercent, issuedShares: set.issuedShares,
      source: { dataset: set.dataset, reference: set.sourceReference, retrievedAt: set.retrievedAt.toISOString(), uploadId: set.uploadId },
      holders: [...set.rows].sort((a, b) => a.lineNo - b.lineNo).map((row) => ({
        holderKey: row.holderKey, holderName: row.holderName, holderKind: row.holderKind, shares: row.shares, percent: row.percent,
        investorType: row.investorType, localForeign: row.localForeign, reference: row.sourceReference,
      })),
      crossHoldings, network,
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
