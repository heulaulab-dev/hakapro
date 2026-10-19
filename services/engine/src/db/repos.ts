// Drizzle implementations of the fetcher/scheduler ports (src/fetch/stores.ts).
import { and, asc, desc, eq, lt, ne, sql } from "drizzle-orm";
import * as t from "../../db/schema";
import type {
  BlockEvidence, CursorStore, RawDocumentIndex, RawDocumentRecord, RunRecorder, RunStatus, RunTotals, SourceStateStore,
} from "../fetch/stores";
import type { SourceDefinition } from "../registry";
import type { EngineDb } from "./client";

type RawRow = typeof t.rawDocuments.$inferSelect;
const toRecord = (row: RawRow): RawDocumentRecord => ({
  id: row.id, source: row.source, url: row.url, fetchedAt: row.fetchedAt, httpStatus: row.httpStatus, sha256: row.sha256,
  r2Key: row.r2Key, contentType: row.contentType, byteSize: row.byteSize, etag: row.etag, lastModified: row.lastModified,
  fetchRunId: row.fetchRunId,
});

export class DbRawDocumentIndex implements RawDocumentIndex {
  constructor(private readonly db: EngineDb) {}

  async latestForUrl(url: string) {
    const [row] = await this.db.select().from(t.rawDocuments).where(eq(t.rawDocuments.url, url)).orderBy(desc(t.rawDocuments.fetchedAt)).limit(1);
    return row ? toRecord(row) : null;
  }

  async findByUrlSha(url: string, sha256: string) {
    const [row] = await this.db.select().from(t.rawDocuments).where(and(eq(t.rawDocuments.url, url), eq(t.rawDocuments.sha256, sha256))).limit(1);
    return row ? toRecord(row) : null;
  }

  async insert(doc: Omit<RawDocumentRecord, "id">) {
    const [row] = await this.db.insert(t.rawDocuments).values(doc).onConflictDoNothing({ target: [t.rawDocuments.url, t.rawDocuments.sha256] }).returning();
    if (row) return toRecord(row);
    const existing = await this.findByUrlSha(doc.url, doc.sha256);
    if (!existing) throw new Error("raw_documents insert conflicted but no row was found");
    return existing;
  }

  async setParseStatus(id: string, status: (typeof t.PARSE_STATUSES)[number], error: string | null = null) {
    await this.db.update(t.rawDocuments).set({ parseStatus: status, parseError: error }).where(eq(t.rawDocuments.id, id));
  }
}

export class DbSourceStateStore implements SourceStateStore {
  constructor(private readonly db: EngineDb) {}

  async isBlocked(id: string) {
    const [row] = await this.db.select({ status: t.sources.status }).from(t.sources).where(eq(t.sources.id, id)).limit(1);
    return row?.status === "BLOCKED";
  }

  async markBlocked(id: string, evidence: BlockEvidence) {
    await this.db.update(t.sources).set({
      status: "BLOCKED", blockedAt: new Date(evidence.detectedAt), blockEvidence: evidence,
      lastErrorAt: new Date(evidence.detectedAt), lastError: `blocked: ${evidence.reason}`, updatedAt: new Date(),
    }).where(eq(t.sources.id, id));
  }

  async unblock(id: string) {
    const rows = await this.db.update(t.sources).set({ status: "NEVER_RUN", blockedAt: null, updatedAt: new Date() })
      .where(and(eq(t.sources.id, id), eq(t.sources.status, "BLOCKED"))).returning({ id: t.sources.id });
    return rows.length > 0;
  }

  async recordSuccess(id: string, rows = 0) {
    // Never clears BLOCKED: only an explicit unblock does.
    await this.db.update(t.sources).set({
      status: sql`case when ${t.sources.status} = 'BLOCKED' then 'BLOCKED' else 'OK' end`,
      lastSuccessAt: new Date(), rowsIngested: sql`${t.sources.rowsIngested} + ${rows}`, updatedAt: new Date(),
    }).where(eq(t.sources.id, id));
  }

  async recordError(id: string, message: string) {
    await this.db.update(t.sources).set({
      status: sql`case when ${t.sources.status} = 'BLOCKED' then 'BLOCKED' else 'ERROR' end`,
      lastErrorAt: new Date(), lastError: message.slice(0, 500), updatedAt: new Date(),
    }).where(eq(t.sources.id, id));
  }
}

export class DbRunRecorder implements RunRecorder {
  constructor(private readonly db: EngineDb) {}

  async start(jobId: string, sourceId: string | null, trigger: "schedule" | "manual") {
    const [row] = await this.db.insert(t.fetchRuns).values({ jobId, sourceId, trigger }).returning({ id: t.fetchRuns.id });
    return row.id;
  }

  async finish(runId: string, result: RunTotals & { status: RunStatus; error?: string | null }) {
    await this.db.update(t.fetchRuns).set({
      status: result.status, finishedAt: new Date(), documentsFetched: result.documentsFetched, documentsNew: result.documentsNew,
      rowsIngested: result.rowsIngested, error: result.error?.slice(0, 1000) ?? null,
    }).where(eq(t.fetchRuns.id, runId));
  }
}

export type JobRunHistory = { id: string; lastStartedAt: string; lastStatus: Exclude<RunStatus, "RUNNING">; lastError: string | null };

/** Latest finished run per job, used to restore health details after an engine restart. */
export async function recentJobHistory(db: EngineDb): Promise<JobRunHistory[]> {
  const rows = await db.selectDistinctOn([t.fetchRuns.jobId], {
    id: t.fetchRuns.jobId, startedAt: t.fetchRuns.startedAt, status: t.fetchRuns.status, error: t.fetchRuns.error,
  }).from(t.fetchRuns).where(ne(t.fetchRuns.status, "RUNNING")).orderBy(t.fetchRuns.jobId, desc(t.fetchRuns.startedAt));
  return rows.map((row) => ({
    id: row.id, lastStartedAt: row.startedAt.toISOString(), lastStatus: row.status as Exclude<RunStatus, "RUNNING">, lastError: row.error,
  }));
}

export class DbCursorStore implements CursorStore {
  constructor(private readonly db: EngineDb) {}

  async get(jobId: string) {
    const [row] = await this.db.select({ cursor: t.jobCursors.cursor }).from(t.jobCursors).where(eq(t.jobCursors.jobId, jobId)).limit(1);
    return row?.cursor ?? null;
  }

  async set(jobId: string, cursor: Record<string, unknown>) {
    await this.db.insert(t.jobCursors).values({ jobId, cursor, updatedAt: new Date() })
      .onConflictDoUpdate({ target: t.jobCursors.jobId, set: { cursor, updatedAt: new Date() } });
  }
}

/** Upserts registry sources (host/policy only; status and history are kept). */
export async function syncSources(db: EngineDb, sources: SourceDefinition[]): Promise<void> {
  for (const source of sources) {
    const policy = { minIntervalMs: source.policy.minIntervalMs, concurrency: source.policy.concurrency };
    await db.insert(t.sources).values({ id: source.id, host: source.host, policy })
      .onConflictDoUpdate({ target: t.sources.id, set: { host: source.host, policy, updatedAt: new Date() } });
  }
}

export type SourceHealth = {
  id: string; host: string; status: string; blocked: boolean; blockedAt: string | null; blockReason: string | null;
  lastSuccessAt: string | null; lastErrorAt: string | null; lastError: string | null; rowsIngested: number;
};

export async function sourceHealth(db: EngineDb): Promise<SourceHealth[]> {
  const rows = await db.select().from(t.sources).orderBy(asc(t.sources.id));
  return rows.map((row) => ({
    id: row.id, host: row.host, status: row.status, blocked: row.status === "BLOCKED",
    blockedAt: row.blockedAt?.toISOString() ?? null, blockReason: row.blockEvidence?.reason ?? null,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null, lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
    lastError: row.lastError, rowsIngested: row.rowsIngested,
  }));
}

/** Deletes up to `limit` intraday snapshots (stocks, then indices) older than `cutoff`; returns the count. */
export async function deleteIntradayOlderThan(db: EngineDb, cutoff: Date, limit: number): Promise<number> {
  const victims = db.select({ symbol: t.intradaySnapshots.symbol, ts: t.intradaySnapshots.ts, source: t.intradaySnapshots.source })
    .from(t.intradaySnapshots).where(lt(t.intradaySnapshots.ts, cutoff)).limit(limit);
  const deleted = await db.delete(t.intradaySnapshots)
    .where(sql`(${t.intradaySnapshots.symbol}, ${t.intradaySnapshots.ts}, ${t.intradaySnapshots.source}) in (${victims})`)
    .returning({ ts: t.intradaySnapshots.ts });
  if (deleted.length >= limit) return deleted.length;
  const indexVictims = db.select({ code: t.indexIntraday.code, ts: t.indexIntraday.ts, source: t.indexIntraday.source })
    .from(t.indexIntraday).where(lt(t.indexIntraday.ts, cutoff)).limit(limit - deleted.length);
  const indexDeleted = await db.delete(t.indexIntraday)
    .where(sql`(${t.indexIntraday.code}, ${t.indexIntraday.ts}, ${t.indexIntraday.source}) in (${indexVictims})`)
    .returning({ ts: t.indexIntraday.ts });
  return deleted.length + indexDeleted.length;
}

