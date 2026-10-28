// Shared plumbing for the E2/E2b jobs: fetch through the polite fetcher, report to the run, record parse status,
// and turn a blocked source into a logged SOURCE_BLOCKED stop that a fallback source can continue after.
import type { EngineDb } from "../db/client";
import type { Provenance } from "../db/ingest";
import { SourceBlockedError, type FetchOptions, type FetchResult, type Fetcher } from "../fetch/fetcher";
import type { HostPolicy } from "../fetch/rate-limit";
import type { SourceStateStore } from "../fetch/stores";
import type { Logger } from "../log";
import type { JobContext } from "../schedule/scheduler";

export type ParseStatusWriter = { setParseStatus(id: string, status: "PARSED" | "FAILED" | "SKIPPED", error?: string | null): Promise<void> };

export type JobServices = {
  db: EngineDb;
  fetcher: Fetcher;
  documents: ParseStatusWriter;
  sourceState: SourceStateStore;
  log: Logger;
  now: () => Date;
};

export type SourceRef = { id: string; policy: HostPolicy; host?: string };

export const provenanceOf = (result: FetchResult): Provenance => ({ source: result.document.source, asOf: result.document.fetchedAt, rawRef: result.document.id });

/** Fetches one document for a job run and counts it in the run totals. */
export async function fetchFor(services: JobServices, ctx: JobContext, source: SourceRef, url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const result = await services.fetcher.fetch(source, url, { accept: "application/json", ...options, fetchRunId: ctx.runId });
  ctx.report.document(result.kind === "new");
  return result;
}

/** Parses a fetched document, recording PARSED or FAILED on its raw_documents row. */
export async function parseDocument<T>(services: JobServices, result: FetchResult, parse: (text: string) => T): Promise<T> {
  try {
    const parsed = parse(await result.text());
    if (result.kind === "new") await services.documents.setParseStatus(result.document.id, "PARSED");
    return parsed;
  } catch (error) {
    await services.documents.setParseStatus(result.document.id, "FAILED", error instanceof Error ? error.message.slice(0, 500) : "parse failed");
    throw error;
  }
}

/**
 * Runs one source's part of a multi-source job. A block is logged as SOURCE_BLOCKED and returned (never retried),
 * so the job can continue with its fallback source; other errors propagate. Success is recorded on the source.
 */
export async function withSource<T>(services: JobServices, ctx: JobContext, sourceId: string, work: () => Promise<{ value: T; rows: number }>): Promise<{ ok: true; value: T } | { ok: false; blocked: true }> {
  if (await services.sourceState.isBlocked(sourceId)) {
    services.log.warn("source_skipped_blocked", { job: ctx.jobId, source: sourceId });
    return { ok: false, blocked: true };
  }
  try {
    const { value, rows } = await work();
    ctx.report.rows(rows);
    await services.sourceState.recordSuccess(sourceId, rows);
    return { ok: true, value };
  } catch (error) {
    if (error instanceof SourceBlockedError) {
      services.log.error("SOURCE_BLOCKED", { job: ctx.jobId, source: sourceId, message: error.message });
      return { ok: false, blocked: true };
    }
    await services.sourceState.recordError(sourceId, error instanceof Error ? error.message : String(error)).catch(() => {});
    throw error;
  }
}
