// Persistence port for ownership uploads, snapshot sets, rows and changes. The Drizzle implementation is
// src/db/ownership.ts; the in-memory one backs the route and service tests.
import { randomUUID } from "node:crypto";
import type { OwnershipUploadIssue, OwnershipUploadStats } from "../../db/schema";
import type { OwnershipChangeFlag, OwnershipChangeKind } from "@/lib/ownership/changes";
import type { OwnershipHolderKind } from "@/lib/ownership/snapshot";
import type { OwnershipFormat } from "./raw-table";

export type UploadStatus = "RECEIVED" | "PARSED" | "FAILED";

export type UploadRecord = {
  id: string;
  receivedAt: Date;
  asOfMonth: string;
  snapshotDate: string | null;
  snapshotDateOverride: string | null;
  sourceLabel: string | null;
  fileName: string | null;
  format: OwnershipFormat;
  contentType: string;
  byteSize: number;
  sha256: string;
  rawRef: string;
  status: UploadStatus;
  error: string | null;
  issues: OwnershipUploadIssue[];
  stats: OwnershipUploadStats | null;
  parsedAt: Date | null;
};
export type NewUpload = Omit<UploadRecord, "id" | "status" | "error" | "issues" | "stats" | "parsedAt" | "snapshotDate">;
export type UploadPatch = Partial<Pick<UploadRecord, "status" | "error" | "issues" | "stats" | "parsedAt" | "snapshotDate">>;

export type StoredRow = {
  lineNo: number; holderKey: string; holderName: string; holderKind: OwnershipHolderKind;
  /** Integer string; percent is a canonical six-decimal string. */
  shares: string | null; percent: string | null; investorType: string | null; localForeign: string | null; sourceReference: string;
};

export type SetHeader = {
  id: string; uploadId: string; symbol: string; month: string; snapshotDate: string; issuerName: string | null; dataset: string;
  thresholdPercent: string; issuedShares: string | null; sourceReference: string; retrievedAt: Date; rawRef: string; rowCount: number;
  comparison: Record<string, unknown> | null; freeFloat: Record<string, unknown> | null;
};
export type StoredSet = SetHeader & { rows: StoredRow[] };
export type NewSet = Omit<SetHeader, "id" | "rowCount" | "comparison" | "freeFloat"> & { rows: StoredRow[] };

export type ChangeRecord = {
  toSetId: string; fromSetId: string; symbol: string; month: string; fromDate: string; toDate: string;
  holderKey: string; holderName: string; holderKind: OwnershipHolderKind; kind: OwnershipChangeKind;
  sharesBefore: string | null; sharesAfter: string | null; shareDelta: string | null;
  percentBefore: string | null; percentAfter: string | null; ppDelta: string | null;
  flags: OwnershipChangeFlag[]; fromReferences: string[]; toReferences: string[]; derivation: string;
};

export type Derivation = { comparison: Record<string, unknown>; freeFloat: Record<string, unknown>; changes: ChangeRecord[] };

export interface OwnershipStore {
  /** Makes sure the `ownership-upload` source exists (raw_documents references it). */
  ensureSource(): Promise<void>;
  findUploadBySha(sha256: string): Promise<UploadRecord | null>;
  getUpload(id: string): Promise<UploadRecord | null>;
  createUpload(upload: NewUpload): Promise<UploadRecord>;
  updateUpload(id: string, patch: UploadPatch): Promise<UploadRecord>;
  /** Newest first. */
  listUploads(limit: number): Promise<UploadRecord[]>;
  /** Stores each set, replacing the same symbol's set for the month (its rows and changes go with it). */
  replaceSets(sets: NewSet[]): Promise<{ stored: SetHeader[]; replaced: number }>;
  /** Deletes this upload's sets except those for `keep` symbols (a re-parse that no longer finds them); returns what went. */
  removeSetsOfUpload(uploadId: string, keep: string[]): Promise<Array<{ symbol: string; month: string }>>;
  getSet(symbol: string, month: string): Promise<StoredSet | null>;
  /** All issuer sets and disclosed holder rows for one monthly KSEI snapshot in a bounded number of DB queries. */
  setsWithRowsInMonth(month: string): Promise<StoredSet[]>;
  /** The symbol's newest set before `month`. */
  previousSet(symbol: string, month: string): Promise<StoredSet | null>;
  /** The symbol's oldest set after `month` (header only). */
  nextSet(symbol: string, month: string): Promise<SetHeader | null>;
  latestSet(symbol: string): Promise<StoredSet | null>;
  /** Replaces the set's comparison, free-float estimate and changes. */
  saveDerivation(setId: string, derivation: Derivation): Promise<void>;
  setsInMonth(month: string, symbol?: string): Promise<SetHeader[]>;
  /** Newest month with any stored set, or null before the first upload. */
  latestMonth(): Promise<string | null>;
  /** Changes into `month` (ordered by symbol, then holder key). */
  changes(month: string, symbol?: string): Promise<ChangeRecord[]>;
  /** The stated investor type of each holder line in these sets (KSEI codes such as CP; null when not stated). */
  holderTypes(setIds: string[]): Promise<HolderType[]>;
  /** Records rows ingested on the ownership source (health). */
  recordIngest(rows: number): Promise<void>;
}

export type HolderType = { setId: string; holderKey: string; investorType: string | null };

const bySymbolKey = (a: { symbol: string; holderKey: string }, b: { symbol: string; holderKey: string }) =>
  a.symbol.localeCompare(b.symbol) || a.holderKey.localeCompare(b.holderKey);

export class MemoryOwnershipStore implements OwnershipStore {
  readonly uploads: UploadRecord[] = [];
  readonly sets: StoredSet[] = [];
  readonly changeRows: ChangeRecord[] = [];
  rowsIngested = 0;

  async ensureSource() {}
  async findUploadBySha(sha256: string) { return this.uploads.find((upload) => upload.sha256 === sha256) ?? null; }
  async getUpload(id: string) { return this.uploads.find((upload) => upload.id === id) ?? null; }
  async createUpload(upload: NewUpload) {
    if (this.uploads.some((existing) => existing.sha256 === upload.sha256)) throw new Error("duplicate sha256");
    const record: UploadRecord = { ...upload, id: randomUUID(), status: "RECEIVED", error: null, issues: [], stats: null, parsedAt: null, snapshotDate: null };
    this.uploads.push(record);
    return record;
  }
  async updateUpload(id: string, patch: UploadPatch) {
    const upload = this.uploads.find((candidate) => candidate.id === id);
    if (!upload) throw new Error(`no upload ${id}`);
    Object.assign(upload, patch);
    return upload;
  }
  async listUploads(limit: number) { return [...this.uploads].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()).slice(0, limit); }

  async replaceSets(sets: NewSet[]) {
    let replaced = 0;
    const stored: SetHeader[] = [];
    for (const set of sets) {
      const index = this.sets.findIndex((existing) => existing.symbol === set.symbol && existing.month === set.month);
      if (index >= 0) {
        const old = this.sets[index];
        this.sets.splice(index, 1);
        for (let i = this.changeRows.length - 1; i >= 0; i -= 1) {
          if (this.changeRows[i].toSetId === old.id || this.changeRows[i].fromSetId === old.id) this.changeRows.splice(i, 1);
        }
        replaced += 1;
      }
      const record: StoredSet = { ...set, id: randomUUID(), rowCount: set.rows.length, comparison: null, freeFloat: null };
      this.sets.push(record);
      const { rows: _rows, ...header } = record;
      stored.push(header);
    }
    return { stored, replaced };
  }
  async removeSetsOfUpload(uploadId: string, keep: string[]) {
    const removed: Array<{ symbol: string; month: string }> = [];
    for (let index = this.sets.length - 1; index >= 0; index -= 1) {
      const set = this.sets[index];
      if (set.uploadId !== uploadId || keep.includes(set.symbol)) continue;
      this.sets.splice(index, 1);
      for (let i = this.changeRows.length - 1; i >= 0; i -= 1) {
        if (this.changeRows[i].toSetId === set.id || this.changeRows[i].fromSetId === set.id) this.changeRows.splice(i, 1);
      }
      removed.push({ symbol: set.symbol, month: set.month });
    }
    return removed;
  }
  async getSet(symbol: string, month: string) { return this.sets.find((set) => set.symbol === symbol && set.month === month) ?? null; }
  async setsWithRowsInMonth(month: string) { return this.sets.filter((set) => set.month === month).sort((a, b) => a.symbol.localeCompare(b.symbol)); }
  async previousSet(symbol: string, month: string) {
    return this.sets.filter((set) => set.symbol === symbol && set.month < month).sort((a, b) => b.month.localeCompare(a.month))[0] ?? null;
  }
  async nextSet(symbol: string, month: string) {
    const next = this.sets.filter((set) => set.symbol === symbol && set.month > month).sort((a, b) => a.month.localeCompare(b.month))[0];
    if (!next) return null;
    const { rows: _rows, ...header } = next;
    return header;
  }
  async latestSet(symbol: string) { return this.sets.filter((set) => set.symbol === symbol).sort((a, b) => b.month.localeCompare(a.month))[0] ?? null; }
  async saveDerivation(setId: string, derivation: Derivation) {
    const set = this.sets.find((candidate) => candidate.id === setId);
    if (!set) throw new Error(`no set ${setId}`);
    set.comparison = derivation.comparison;
    set.freeFloat = derivation.freeFloat;
    for (let i = this.changeRows.length - 1; i >= 0; i -= 1) if (this.changeRows[i].toSetId === setId) this.changeRows.splice(i, 1);
    this.changeRows.push(...derivation.changes);
  }
  async latestMonth() {
    return this.sets.map((set) => set.month).sort().at(-1) ?? null;
  }
  async setsInMonth(month: string, symbol?: string) {
    return this.sets.filter((set) => set.month === month && (!symbol || set.symbol === symbol)).sort((a, b) => a.symbol.localeCompare(b.symbol))
      .map(({ rows: _rows, ...header }) => header);
  }
  async changes(month: string, symbol?: string) {
    return this.changeRows.filter((change) => change.month === month && (!symbol || change.symbol === symbol)).sort(bySymbolKey);
  }
  async holderTypes(setIds: string[]) {
    return this.sets.filter((set) => setIds.includes(set.id))
      .flatMap((set) => set.rows.map((row) => ({ setId: set.id, holderKey: row.holderKey, investorType: row.investorType })));
  }
  async recordIngest(rows: number) { this.rowsIngested += rows; }
}
