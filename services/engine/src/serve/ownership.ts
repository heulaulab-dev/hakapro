// Builds the ownership /v1 payloads (E6) from stored snapshot sets and changes. The HTTP layer validates them with the
// shared schemas (src/server/schemas/ownership.ts). Monthly position data is HISTORICAL, dated by its position date.
import type { z } from "zod";
import type { OwnershipNetworkReplay, ownershipChangesSchema, ownershipScreenerSchema, ownershipUploadSchema, stockOwnershipSchema } from "@/server/schemas/ownership";
import { OWNERSHIP_CHANGE_KINDS, type OwnershipChangeKind } from "@/lib/ownership/changes";
import { previousMonth } from "../ownership/numbers";
import type { OwnershipStore, SetHeader, StoredSet, UploadRecord } from "../ownership/store";
import type { Served } from "./market";

type StockOwnership = z.input<typeof stockOwnershipSchema>;
type OwnershipChanges = z.input<typeof ownershipChangesSchema>;
type OwnershipScreener = z.input<typeof ownershipScreenerSchema>;

/** Aggregates only rows published in the latest KSEI ≥1% register. */
export async function serveOwnershipScreener(store: OwnershipStore): Promise<Served<OwnershipScreener> | null> {
  const month = await store.latestMonth();
  if (!month) return null;
  const sets = await store.setsWithRowsInMonth(month);
  const classifications = new Map<string, number>();
  let local = 0, foreign = 0, unknown = 0;
  const holders = new Set<string>();
  const rows = sets.flatMap((set) => set.rows.map((row) => {
    holders.add(row.holderKey);
    if (row.localForeign === "L") local += 1; else if (row.localForeign === "F") foreign += 1; else unknown += 1;
    if (row.investorType) classifications.set(row.investorType, (classifications.get(row.investorType) ?? 0) + 1);
    return { symbol: set.symbol, issuerName: set.issuerName, holderName: row.holderName, holderKind: row.holderKind, investorType: row.investorType, localForeign: row.localForeign, shares: row.shares, percent: row.percent };
  }));
  const snapshotDate = sets.map((set) => set.snapshotDate).sort().at(-1)!;
  return { data: { month, snapshotDate, issuers: sets.length, investors: holders.size, holdings: rows.length, localForeign: { local, foreign, unknown }, classifications: [...classifications].map(([name, holdings]) => ({ name, holdings })).sort((a, b) => b.holdings - a.holdings), rows }, dataAsOf: snapshotDate, freshness: "HISTORICAL" };
}

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

function ownershipNetworkFromSets(sets: StoredSet[]): NonNullable<StockOwnership["network"]> {
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
      edges.push({ from: `holder:${row.holderKey}`, to: `issuer:${set.symbol}`, percent: row.percent, shares: row.shares, month: set.month, sourceReference: row.sourceReference, confidence: "exact" });
    }
  }
  return { nodes: [...nodes.values()], edges, ambiguous: ambiguous.size };
}

export async function ownershipNetworkFor(store: OwnershipStore, month: string): Promise<NonNullable<StockOwnership["network"]>> {
  return ownershipNetworkFromSets(await store.setsWithRowsInMonth(month));
}

const replayChangeKinds = OWNERSHIP_CHANGE_KINDS as readonly OwnershipChangeKind[];
const replayStatuses = ["COMPARED", "NO_PREVIOUS", "NOT_ADJACENT", "REFUSED"] as const;
type ReplayStatus = (typeof replayStatuses)[number];

function emptyReplayCounts(): Record<OwnershipChangeKind, number> {
  return Object.fromEntries(replayChangeKinds.map((kind) => [kind, 0])) as Record<OwnershipChangeKind, number>;
}

function replayStatusCounts(): Record<ReplayStatus, number> {
  return { COMPARED: 0, NO_PREVIOUS: 0, NOT_ADJACENT: 0, REFUSED: 0 };
}

/** One month of uploaded KSEI records. Month changes are included only for calendar-adjacent sets. */
function emptyNetworkReplay(months: string[]): OwnershipNetworkReplay {
  return {
    availability: "ENABLED", months, month: null, snapshotDate: null, issuers: 0, holdings: 0,
    issuerRecords: [], rows: [], network: { nodes: [], edges: [], ambiguous: 0 },
    comparison: { status: "UNAVAILABLE", fromMonth: null, comparedIssuers: 0, statusCounts: replayStatusCounts(), counts: emptyReplayCounts() },
  };
}

export async function serveOwnershipNetwork(store: OwnershipStore, requestedMonth?: string): Promise<Served<OwnershipNetworkReplay>> {
  const months = await store.months();
  const month = requestedMonth ?? months[0] ?? null;
  if (!month || !months.includes(month)) return { data: emptyNetworkReplay(months), dataAsOf: null, freshness: "UNAVAILABLE" };

  const sets = await store.setsWithRowsInMonth(month);
  if (!sets.length) return { data: emptyNetworkReplay(months), dataAsOf: null, freshness: "UNAVAILABLE" };
  const snapshotDate = sets.map((set) => set.snapshotDate).sort().at(-1)!;
  const priorAvailableMonth = months.find((candidate) => candidate < month) ?? null;
  const previousCalendarMonth = previousMonth(month);
  const isAdjacent = priorAvailableMonth === previousCalendarMonth;
  const comparison: OwnershipNetworkReplay["comparison"] = {
    status: "UNAVAILABLE", fromMonth: null, comparedIssuers: 0, statusCounts: replayStatusCounts(), counts: emptyReplayCounts(),
  };
  comparison.status = isAdjacent ? "COMPARED" : priorAvailableMonth ? "NOT_ADJACENT" : "NO_PREVIOUS";
  comparison.fromMonth = isAdjacent ? previousCalendarMonth : null;

  const comparedSetIds = new Set<string>();
  for (const set of sets) {
    const storedComparison = set.comparison as { status?: string; fromMonth?: string | null } | null;
    let status: ReplayStatus = isAdjacent ? "REFUSED" : priorAvailableMonth ? "NOT_ADJACENT" : "NO_PREVIOUS";
    if (storedComparison?.status && replayStatuses.includes(storedComparison.status as ReplayStatus)) status = storedComparison.status as ReplayStatus;
    if (isAdjacent && status === "COMPARED" && storedComparison?.fromMonth === previousCalendarMonth) {
      comparedSetIds.add(set.id);
      comparison.comparedIssuers += 1;
    } else if (isAdjacent && status === "COMPARED") {
      status = "REFUSED";
    }
    comparison.statusCounts[status] += 1;
  }
  if (isAdjacent && comparison.comparedIssuers === 0) comparison.status = "REFUSED";

  if (comparedSetIds.size) {
    for (const change of await store.changes(month)) {
      if (!comparedSetIds.has(change.toSetId)) continue;
      comparison.counts[change.kind] += 1;
    }
  }

  const issuerRecords = sets.map((set) => ({
    symbol: set.symbol, issuerName: set.issuerName, snapshotDate: set.snapshotDate, dataset: set.dataset,
    reference: set.sourceReference, retrievedAt: set.retrievedAt.toISOString(), rowCount: set.rowCount, thresholdPercent: set.thresholdPercent,
  }));
  const rows = sets.flatMap((set) => set.rows.map((row) => ({
    symbol: set.symbol, issuerName: set.issuerName, holderName: row.holderName, holderKind: row.holderKind,
    investorType: row.investorType, localForeign: row.localForeign, shares: row.shares, percent: row.percent, reference: row.sourceReference,
  })));
  return {
    data: { availability: "ENABLED", months, month, snapshotDate, issuers: sets.length, holdings: rows.length, issuerRecords, rows, network: ownershipNetworkFromSets(sets), comparison },
    dataAsOf: snapshotDate, freshness: "HISTORICAL",
  };
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
