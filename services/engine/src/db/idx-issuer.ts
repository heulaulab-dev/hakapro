// IDX profile snapshots are source-specific corporate disclosures, never KSEI ownership snapshots.
import { and, eq, sql } from "drizzle-orm";
import * as t from "../../db/schema";
import type { EngineDb } from "./client";
import type { IdxIssuerProfile } from "../sources/idx-company";

export type IdxIssuerProfileRecord = IdxIssuerProfile & { retrievedAt: Date; source: string; asOf: Date };

export async function upsertIdxIssuerProfile(db: EngineDb, row: IdxIssuerProfile, provenance: { source: string; asOf: Date; rawRef: string | null }) {
  await db.insert(t.idxIssuerProfiles).values({ ...row, retrievedAt: provenance.asOf, ...provenance }).onConflictDoUpdate({
    target: [t.idxIssuerProfiles.symbol, t.idxIssuerProfiles.language],
    set: {
      profile: sql`excluded."profile"`, directors: sql`excluded."directors"`, commissioners: sql`excluded."commissioners"`,
      auditCommittee: sql`excluded."audit_committee"`, shareholders: sql`excluded."shareholders"`, subsidiaries: sql`excluded."subsidiaries"`,
      retrievedAt: sql`excluded."retrieved_at"`, source: sql`excluded."source"`, asOf: sql`excluded."as_of"`, rawRef: sql`excluded."raw_ref"`,
    },
  });
}

export async function getIdxIssuerProfile(db: EngineDb, symbol: string, language = "id-id"): Promise<IdxIssuerProfileRecord | null> {
  const [row] = await db.select().from(t.idxIssuerProfiles).where(and(eq(t.idxIssuerProfiles.symbol, symbol), eq(t.idxIssuerProfiles.language, language))).limit(1);
  return row ?? null;
}
