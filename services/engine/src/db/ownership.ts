// Drizzle implementation of the ownership store (src/ownership/store.ts). A set replacement is one transaction: the
// old set of the symbol and month goes (its rows and changes cascade), the new set and its rows go in.
import { and, asc, desc, eq, gt, inArray, lt, notInArray, sql } from "drizzle-orm";
import * as t from "../../db/schema";
import { OWNERSHIP_SOURCE_HOST, OWNERSHIP_SOURCE_ID } from "../ownership/service";
import type { ChangeRecord, Derivation, NewSet, NewUpload, OwnershipStore, SetHeader, StoredRow, StoredSet, UploadPatch, UploadRecord } from "../ownership/store";
import type { EngineDb } from "./client";

type UploadRow = typeof t.ownershipUploads.$inferSelect;
type SetRow = typeof t.ownershipSnapshotSets.$inferSelect;
type ChangeRow = typeof t.ownershipChanges.$inferSelect;

const toUpload = (row: UploadRow): UploadRecord => ({ ...row });
const toHeader = (row: SetRow): SetHeader => ({
  id: row.id, uploadId: row.uploadId, symbol: row.symbol, month: row.month, snapshotDate: row.snapshotDate, issuerName: row.issuerName,
  dataset: row.dataset, thresholdPercent: row.thresholdPercent, issuedShares: row.issuedShares, sourceReference: row.sourceReference,
  retrievedAt: row.retrievedAt, rawRef: row.rawRef, rowCount: row.rowCount, comparison: row.comparison, freeFloat: row.freeFloat,
});
const toChange = (row: ChangeRow): ChangeRecord => ({
  toSetId: row.toSetId, fromSetId: row.fromSetId, symbol: row.symbol, month: row.month, fromDate: row.fromDate, toDate: row.toDate,
  holderKey: row.holderKey, holderName: row.holderName, holderKind: row.holderKind, kind: row.kind,
  sharesBefore: row.sharesBefore, sharesAfter: row.sharesAfter, shareDelta: row.shareDelta,
  percentBefore: row.percentBefore, percentAfter: row.percentAfter, ppDelta: row.ppDelta,
  flags: row.flags as ChangeRecord["flags"], fromReferences: row.fromReferences, toReferences: row.toReferences, derivation: row.derivation,
});

/** Rows per INSERT statement (well under PostgreSQL's 65,535 bind parameters). */
const BATCH = 1000;

export class DbOwnershipStore implements OwnershipStore {
  constructor(private readonly db: EngineDb) {}

  async ensureSource() {
    await this.db.insert(t.sources).values({ id: OWNERSHIP_SOURCE_ID, host: OWNERSHIP_SOURCE_HOST, policy: { minIntervalMs: 0, concurrency: 1 } })
      .onConflictDoNothing({ target: t.sources.id });
  }

  async findUploadBySha(sha256: string) {
    const [row] = await this.db.select().from(t.ownershipUploads).where(eq(t.ownershipUploads.sha256, sha256)).limit(1);
    return row ? toUpload(row) : null;
  }

  async getUpload(id: string) {
    const [row] = await this.db.select().from(t.ownershipUploads).where(eq(t.ownershipUploads.id, id)).limit(1);
    return row ? toUpload(row) : null;
  }

  async createUpload(upload: NewUpload) {
    const [row] = await this.db.insert(t.ownershipUploads).values(upload).returning();
    return toUpload(row);
  }

  async updateUpload(id: string, patch: UploadPatch) {
    const [row] = await this.db.update(t.ownershipUploads).set(patch).where(eq(t.ownershipUploads.id, id)).returning();
    if (!row) throw new Error(`no upload ${id}`);
    return toUpload(row);
  }

  async listUploads(limit: number) {
    const rows = await this.db.select().from(t.ownershipUploads).orderBy(desc(t.ownershipUploads.receivedAt)).limit(limit);
    return rows.map(toUpload);
  }

  async removeSetsOfUpload(uploadId: string, keep: string[]) {
    const where = keep.length
      ? and(eq(t.ownershipSnapshotSets.uploadId, uploadId), notInArray(t.ownershipSnapshotSets.symbol, keep))
      : eq(t.ownershipSnapshotSets.uploadId, uploadId);
    return this.db.delete(t.ownershipSnapshotSets).where(where).returning({ symbol: t.ownershipSnapshotSets.symbol, month: t.ownershipSnapshotSets.month });
  }

  async replaceSets(sets: NewSet[]) {
    return this.db.transaction(async (tx) => {
      let replaced = 0;
      const stored: SetHeader[] = [];
      for (const { rows, ...set } of sets) {
        const deleted = await tx.delete(t.ownershipSnapshotSets)
          .where(and(eq(t.ownershipSnapshotSets.symbol, set.symbol), eq(t.ownershipSnapshotSets.month, set.month)))
          .returning({ id: t.ownershipSnapshotSets.id });
        replaced += deleted.length;
        const [header] = await tx.insert(t.ownershipSnapshotSets).values({ ...set, rowCount: rows.length }).returning();
        for (let index = 0; index < rows.length; index += BATCH) {
          await tx.insert(t.ownershipSnapshotRows).values(rows.slice(index, index + BATCH).map((row) => ({ ...row, setId: header.id })));
        }
        stored.push(toHeader(header));
      }
      return { stored, replaced };
    });
  }

  private async withRows(row: SetRow | undefined): Promise<StoredSet | null> {
    if (!row) return null;
    const rows = await this.db.select({
      lineNo: t.ownershipSnapshotRows.lineNo, holderKey: t.ownershipSnapshotRows.holderKey, holderName: t.ownershipSnapshotRows.holderName,
      holderKind: t.ownershipSnapshotRows.holderKind, shares: t.ownershipSnapshotRows.shares, percent: t.ownershipSnapshotRows.percent,
      investorType: t.ownershipSnapshotRows.investorType, localForeign: t.ownershipSnapshotRows.localForeign, sourceReference: t.ownershipSnapshotRows.sourceReference,
    }).from(t.ownershipSnapshotRows).where(eq(t.ownershipSnapshotRows.setId, row.id)).orderBy(asc(t.ownershipSnapshotRows.lineNo));
    return { ...toHeader(row), rows: rows as StoredRow[] };
  }

  async getSet(symbol: string, month: string) {
    const [row] = await this.db.select().from(t.ownershipSnapshotSets)
      .where(and(eq(t.ownershipSnapshotSets.symbol, symbol), eq(t.ownershipSnapshotSets.month, month))).limit(1);
    return this.withRows(row);
  }

  async previousSet(symbol: string, month: string) {
    const [row] = await this.db.select().from(t.ownershipSnapshotSets)
      .where(and(eq(t.ownershipSnapshotSets.symbol, symbol), lt(t.ownershipSnapshotSets.month, month)))
      .orderBy(desc(t.ownershipSnapshotSets.month)).limit(1);
    return this.withRows(row);
  }

  async nextSet(symbol: string, month: string) {
    const [row] = await this.db.select().from(t.ownershipSnapshotSets)
      .where(and(eq(t.ownershipSnapshotSets.symbol, symbol), gt(t.ownershipSnapshotSets.month, month)))
      .orderBy(asc(t.ownershipSnapshotSets.month)).limit(1);
    return row ? toHeader(row) : null;
  }

  async latestSet(symbol: string) {
    const [row] = await this.db.select().from(t.ownershipSnapshotSets).where(eq(t.ownershipSnapshotSets.symbol, symbol))
      .orderBy(desc(t.ownershipSnapshotSets.month)).limit(1);
    return this.withRows(row);
  }

  async saveDerivation(setId: string, derivation: Derivation) {
    await this.db.transaction(async (tx) => {
      await tx.update(t.ownershipSnapshotSets).set({ comparison: derivation.comparison, freeFloat: derivation.freeFloat, derivedAt: new Date() })
        .where(eq(t.ownershipSnapshotSets.id, setId));
      await tx.delete(t.ownershipChanges).where(eq(t.ownershipChanges.toSetId, setId));
      for (let index = 0; index < derivation.changes.length; index += BATCH) {
        await tx.insert(t.ownershipChanges).values(derivation.changes.slice(index, index + BATCH));
      }
    });
  }

  async latestMonth() {
    const [row] = await this.db.select({ month: t.ownershipSnapshotSets.month }).from(t.ownershipSnapshotSets).orderBy(desc(t.ownershipSnapshotSets.month)).limit(1);
    return row?.month ?? null;
  }

  async setsInMonth(month: string, symbol?: string) {
    const rows = await this.db.select().from(t.ownershipSnapshotSets)
      .where(symbol ? and(eq(t.ownershipSnapshotSets.month, month), eq(t.ownershipSnapshotSets.symbol, symbol)) : eq(t.ownershipSnapshotSets.month, month))
      .orderBy(asc(t.ownershipSnapshotSets.symbol));
    return rows.map(toHeader);
  }

  async changes(month: string, symbol?: string) {
    const rows = await this.db.select().from(t.ownershipChanges)
      .where(symbol ? and(eq(t.ownershipChanges.month, month), eq(t.ownershipChanges.symbol, symbol)) : eq(t.ownershipChanges.month, month))
      .orderBy(asc(t.ownershipChanges.symbol), asc(t.ownershipChanges.holderKey));
    return rows.map(toChange);
  }

  async holderTypes(setIds: string[]) {
    if (!setIds.length) return [];
    return this.db.select({ setId: t.ownershipSnapshotRows.setId, holderKey: t.ownershipSnapshotRows.holderKey, investorType: t.ownershipSnapshotRows.investorType })
      .from(t.ownershipSnapshotRows).where(inArray(t.ownershipSnapshotRows.setId, setIds));
  }

  async recordIngest(rows: number) {
    await this.db.update(t.sources).set({
      status: sql`case when ${t.sources.status} = 'BLOCKED' then 'BLOCKED' else 'OK' end`,
      lastSuccessAt: new Date(), rowsIngested: sql`${t.sources.rowsIngested} + ${rows}`, updatedAt: new Date(),
    }).where(eq(t.sources.id, OWNERSHIP_SOURCE_ID));
  }
}
