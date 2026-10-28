// Storage for IDX GetBrokerSummary market-wide broker totals. This grain is date×broker, not date×stock×broker.
import { and, asc, desc, eq, gte, lte, max, notInArray, sql } from "drizzle-orm";
import * as t from "../../db/schema";
import type { EngineDb } from "./client";
import type { Provenance } from "./ingest";
import type { IdxBrokerDailyUpsert } from "../sources/idx-broker-summary";
import type { IdxBrokerMember } from "../sources/idx-broker-directory";

export type BrokerDailySummaryRecord = IdxBrokerDailyUpsert & { source: string; asOf: Date };
export type BrokerMemberRecord = IdxBrokerMember & { active: boolean; source: string; asOf: Date };

/** Atomically replace membership from a complete, nonempty IDX snapshot; partial input can never deactivate firms. */
export async function upsertIdxBrokerMembers(db: EngineDb, snapshot: { rows: IdxBrokerMember[]; complete: boolean }, provenance: Provenance): Promise<number> {
  if (!snapshot.complete || !snapshot.rows.length) throw new Error("refusing to reconcile IDX broker directory from an incomplete snapshot");
  const rows = snapshot.rows;
  await db.transaction(async (tx) => {
    await tx.insert(t.idxBrokerMembers).values(rows.map((row) => ({
      brokerCode: row.code, firmName: row.name, license: row.license, active: true,
      source: provenance.source, asOf: provenance.asOf, rawRef: provenance.rawRef,
    }))).onConflictDoUpdate({
      target: t.idxBrokerMembers.brokerCode,
      set: { firmName: sql`excluded."firm_name"`, license: sql`excluded."license"`, active: true, source: sql`excluded."source"`, asOf: sql`excluded."as_of"`, rawRef: sql`excluded."raw_ref"` },
    });
    await tx.update(t.idxBrokerMembers).set({ active: false, source: provenance.source, asOf: provenance.asOf, rawRef: provenance.rawRef })
      .where(notInArray(t.idxBrokerMembers.brokerCode, rows.map((row) => row.code)));
  });
  return rows.length;
}

export async function idxBrokerMembers(db: EngineDb): Promise<BrokerMemberRecord[]> {
  return db.select({ code: t.idxBrokerMembers.brokerCode, name: t.idxBrokerMembers.firmName, license: t.idxBrokerMembers.license, active: t.idxBrokerMembers.active, source: t.idxBrokerMembers.source, asOf: t.idxBrokerMembers.asOf })
    .from(t.idxBrokerMembers).where(eq(t.idxBrokerMembers.active, true)).orderBy(asc(t.idxBrokerMembers.brokerCode));
}

export async function latestIdxBrokerMembersAsOf(db: EngineDb): Promise<Date | null> {
  const [row] = await db.select({ asOf: max(t.idxBrokerMembers.asOf) }).from(t.idxBrokerMembers);
  return row?.asOf ?? null;
}

/** Replaying the same date×broker rows updates the official values and provenance without duplicating records. */
export async function upsertIdxBrokerDaily(db: EngineDb, rows: IdxBrokerDailyUpsert[], provenance: Provenance): Promise<number> {
  if (!rows.length) return 0;
  await db.insert(t.brokerDailySummaries).values(rows.map((row) => ({ ...row, source: provenance.source, asOf: provenance.asOf, rawRef: provenance.rawRef })))
    .onConflictDoUpdate({
      target: [t.brokerDailySummaries.date, t.brokerDailySummaries.brokerCode],
      set: {
        firmName: sql`coalesce(excluded."firm_name", ${t.brokerDailySummaries.firmName})`,
        volume: sql`excluded."volume"`, value: sql`excluded."value"`, frequency: sql`excluded."frequency"`,
        source: sql`excluded."source"`, asOf: sql`excluded."as_of"`, rawRef: sql`excluded."raw_ref"`,
      },
    });
  return rows.length;
}

export async function brokerDailyBetween(db: EngineDb, from: string, to: string): Promise<BrokerDailySummaryRecord[]> {
  return db.select({
    date: t.brokerDailySummaries.date, brokerCode: t.brokerDailySummaries.brokerCode, firmName: t.brokerDailySummaries.firmName,
    volume: t.brokerDailySummaries.volume, value: t.brokerDailySummaries.value, frequency: t.brokerDailySummaries.frequency,
    source: t.brokerDailySummaries.source, asOf: t.brokerDailySummaries.asOf,
  }).from(t.brokerDailySummaries).where(and(gte(t.brokerDailySummaries.date, from), lte(t.brokerDailySummaries.date, to)))
    .orderBy(asc(t.brokerDailySummaries.date), desc(t.brokerDailySummaries.value), asc(t.brokerDailySummaries.brokerCode));
}

export async function latestBrokerSummaryDate(db: EngineDb): Promise<string | null> {
  const [row] = await db.select({ date: max(t.brokerDailySummaries.date) }).from(t.brokerDailySummaries);
  return row?.date ?? null;
}
