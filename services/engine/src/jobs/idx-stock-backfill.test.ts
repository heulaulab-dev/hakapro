import { describe, expect, it, vi } from "vitest";
import { MemoryCursorStore } from "../fetch/stores";
import type { JobContext } from "../schedule/scheduler";
import type { IdxFetchResult, IdxJsonTransport } from "../sources/idx-primary";
import response from "../sources/fixtures/idx-stock-summary.2026-08-07.json";
import { idxStockBackfillJob, IDX_STOCK_BACKFILL_ID } from "./idx-stock-backfill";
import type { JobServices, SourceRef } from "./common";

const SOURCE: SourceRef = { id: "idx-primary", policy: { minIntervalMs: 2000, concurrency: 1 } };
const DATE = "2026-08-07";
const services = (now: string): JobServices => ({
  db: {} as never, log: { info: () => {}, warn: () => {}, error: () => {} }, now: () => new Date(now),
}) as unknown as JobServices;

function context(cursors: MemoryCursorStore, jobId: string): JobContext & { rows: number } {
  const ctx = {
    rows: 0, runId: "r", jobId, trigger: "schedule" as const, startedAt: new Date(), shouldYield: () => false,
    cursor: { get: () => cursors.get(jobId), set: (value: Record<string, unknown>) => cursors.set(jobId, value) },
    report: { document: () => {}, rows: (n: number) => { ctx.rows += n; } },
  };
  return ctx;
}

function fixtureTransport(body: unknown = response): IdxJsonTransport {
  return {
    id: "fixture", async fetchIndexSummary(): Promise<IdxFetchResult> { return { ok: false, reason: "unused" }; },
    async fetchJson(_path, params): Promise<IdxFetchResult> {
      return params.date === DATE.replace(/-/g, "") ? { ok: true, body } : { ok: true, body: { data: [] } };
    },
  };
}

describe("idxStockBackfillJob", () => {
  it("persists stock rows as secondary OHLC with IDX foreign-flow provenance", async () => {
    const persist = vi.fn(async (_db: unknown, rows: Array<{ symbol: string; foreignBuy?: number | null }>, _prov: unknown, _policy: unknown) => rows.length);
    const job = idxStockBackfillJob(services("2026-08-10T12:00:00Z"), SOURCE, fixtureTransport(), {
      from: DATE, batchDays: 1, cursorRevision: "r2", persist,
    });
    const cursors = new MemoryCursorStore();
    const ctx = context(cursors, job.id);

    expect(job.id).toBe(IDX_STOCK_BACKFILL_ID);
    await job.run(ctx);

    expect(persist).toHaveBeenCalledOnce();
    expect(persist.mock.calls[0][1]).toMatchObject([{ symbol: "AADI", close: 9075, foreignBuy: 1240100, foreignSell: 845200 }]);
    expect(persist.mock.calls[0][3]).toEqual({ primary: false, value: "fill", foreign: true });
    expect(ctx.rows).toBe(1);
    expect(await cursors.get(job.id)).toMatchObject({ updatedFor: `${DATE}:r2` });
  });

  it("does not advance the date cursor for unavailable or empty stock responses", async () => {
    for (const result of [{ ok: false as const, reason: "upstream unavailable" }, { ok: true as const, body: { data: [] } }]) {
      const transport = fixtureTransport();
      transport.fetchJson = async () => result;
      const persist = vi.fn(async () => 0);
      const job = idxStockBackfillJob(services("2026-08-10T12:00:00Z"), SOURCE, transport, { from: DATE, batchDays: 1, persist });
      const cursors = new MemoryCursorStore();
      await expect(job.run(context(cursors, job.id))).rejects.toThrow();
      expect(persist).not.toHaveBeenCalled();
      expect(await cursors.get(job.id)).toBeNull();
    }
  });
});
