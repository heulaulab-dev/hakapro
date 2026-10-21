// Persistence ports used by the fetcher and scheduler. Drizzle implementations live in src/db/repos.ts;
// the in-memory ones here back unit tests.
import { randomUUID } from "node:crypto";
import type { BlockEvidence } from "../../db/schema";
import { cooldownOver, withCooldown } from "./block";

export type { BlockEvidence };

export type RawDocumentRecord = {
  id: string;
  source: string;
  url: string;
  fetchedAt: Date;
  httpStatus: number;
  sha256: string;
  r2Key: string;
  contentType: string | null;
  byteSize: number;
  etag: string | null;
  lastModified: string | null;
  fetchRunId: string | null;
};

export interface RawDocumentIndex {
  /** Most recent document for a URL (source of the conditional-request validators). */
  latestForUrl(url: string): Promise<RawDocumentRecord | null>;
  findByUrlSha(url: string, sha256: string): Promise<RawDocumentRecord | null>;
  /** Idempotent on (url, sha256): returns the existing row on conflict. */
  insert(doc: Omit<RawDocumentRecord, "id">): Promise<RawDocumentRecord>;
}

export interface SourceStateStore {
  /** False once a rate-limit cooldown is over: the block is lifted then (status ERROR until the next success). */
  isBlocked(sourceId: string): Promise<boolean>;
  /** Stores the block with its cooldown (block.ts withCooldown) and returns the stored evidence. */
  markBlocked(sourceId: string, evidence: BlockEvidence): Promise<BlockEvidence>;
  unblock(sourceId: string): Promise<boolean>;
  recordSuccess(sourceId: string, rows?: number): Promise<void>;
  recordError(sourceId: string, message: string): Promise<void>;
}

export type RunStatus = "SUCCEEDED" | "FAILED" | "BLOCKED" | "YIELDED";
export type RunTotals = { documentsFetched: number; documentsNew: number; rowsIngested: number };

export interface RunRecorder {
  start(jobId: string, sourceId: string | null, trigger: "schedule" | "manual"): Promise<string>;
  finish(runId: string, result: RunTotals & { status: RunStatus; error?: string | null }): Promise<void>;
}

export interface CursorStore {
  get(jobId: string): Promise<Record<string, unknown> | null>;
  set(jobId: string, cursor: Record<string, unknown>): Promise<void>;
}

export class MemoryRawDocumentIndex implements RawDocumentIndex {
  readonly docs: RawDocumentRecord[] = [];

  async latestForUrl(url: string) {
    return this.docs.filter((doc) => doc.url === url).sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime())[0] ?? null;
  }

  async findByUrlSha(url: string, sha256: string) {
    return this.docs.find((doc) => doc.url === url && doc.sha256 === sha256) ?? null;
  }

  async insert(doc: Omit<RawDocumentRecord, "id">) {
    const existing = await this.findByUrlSha(doc.url, doc.sha256);
    if (existing) return existing;
    const record = { ...doc, id: randomUUID() };
    this.docs.push(record);
    return record;
  }
}

/** `lastBlock` outlives an unblock or a finished cooldown, so the next rate limit continues the strike count. */
export type MemorySourceState = { blocked: BlockEvidence | null; lastBlock: BlockEvidence | null; lastSuccessAt: Date | null; lastError: string | null; rows: number };

export class MemorySourceStateStore implements SourceStateStore {
  readonly state = new Map<string, MemorySourceState>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  private entry(id: string): MemorySourceState {
    let entry = this.state.get(id);
    if (!entry) {
      entry = { blocked: null, lastBlock: null, lastSuccessAt: null, lastError: null, rows: 0 };
      this.state.set(id, entry);
    }
    return entry;
  }

  async isBlocked(id: string) {
    const entry = this.entry(id);
    if (entry.blocked && cooldownOver(entry.blocked, this.now())) entry.blocked = null;
    return entry.blocked !== null;
  }
  async markBlocked(id: string, evidence: BlockEvidence) {
    const entry = this.entry(id);
    const stored = withCooldown(evidence, entry.lastBlock);
    entry.blocked = stored;
    entry.lastBlock = stored;
    return stored;
  }
  async unblock(id: string) {
    const entry = this.entry(id);
    const was = entry.blocked !== null;
    entry.blocked = null;
    return was;
  }
  async recordSuccess(id: string, rows = 0) {
    const entry = this.entry(id);
    entry.lastSuccessAt = new Date();
    entry.rows += rows;
  }
  async recordError(id: string, message: string) { this.entry(id).lastError = message; }
}

export class MemoryRunRecorder implements RunRecorder {
  readonly runs = new Map<string, { jobId: string; sourceId: string | null; trigger: string; status: string; totals?: RunTotals; error?: string | null }>();

  async start(jobId: string, sourceId: string | null, trigger: "schedule" | "manual") {
    const id = randomUUID();
    this.runs.set(id, { jobId, sourceId, trigger, status: "RUNNING" });
    return id;
  }

  async finish(runId: string, result: RunTotals & { status: RunStatus; error?: string | null }) {
    const run = this.runs.get(runId);
    if (run) Object.assign(run, { status: result.status, totals: result, error: result.error ?? null });
  }
}

export class MemoryCursorStore implements CursorStore {
  readonly cursors = new Map<string, Record<string, unknown>>();
  async get(jobId: string) { return this.cursors.get(jobId) ?? null; }
  async set(jobId: string, cursor: Record<string, unknown>) { this.cursors.set(jobId, cursor); }
}
