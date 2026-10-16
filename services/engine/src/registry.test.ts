import { describe, expect, it } from "vitest";
import { defineSource, intradayRetentionJob, retentionCutoff, validateRegistry } from "./registry";
import type { JobContext } from "./schedule/scheduler";

const ctx = (shouldYield = () => false) => ({ shouldYield } as unknown as JobContext);

describe("defineSource", () => {
  it("forces concurrency 1 for intraday sources", () => {
    expect(defineSource({ id: "q", host: "q.test", kind: "intraday", policy: { minIntervalMs: 2000, concurrency: 2 } }).policy.concurrency).toBe(1);
    expect(defineSource({ id: "e", host: "e.test", kind: "eod", policy: { minIntervalMs: 2000, concurrency: 2 } }).policy.concurrency).toBe(2);
  });

  it("validates ids and job→source references", () => {
    expect(() => defineSource({ id: "Bad Id", host: "x", kind: "eod", policy: { minIntervalMs: 1, concurrency: 1 } })).toThrow();
    expect(() => validateRegistry({ sources: [], jobs: [{ id: "j", sourceId: "missing", trigger: { kind: "cron", spec: "* * * * *" }, run: async () => {} }] })).toThrow(/unknown source/);
  });
});

describe("intraday retention", () => {
  it("cuts off at exactly N days before now", () => {
    expect(retentionCutoff(new Date("2026-10-16T00:00:00Z"), 30).toISOString()).toBe("2026-09-16T00:00:00.000Z");
  });

  it("deletes in batches until a short batch, daily at 02:30 WIB as a background job", async () => {
    const cutoffs: Date[] = [];
    const batches = [5000, 5000, 12];
    const job = intradayRetentionJob({
      retentionDays: 30, now: () => new Date("2026-10-16T00:00:00Z"),
      deleteOlderThan: async (cutoff) => { cutoffs.push(cutoff); return batches.shift() ?? 0; },
    });
    expect(job.trigger).toEqual({ kind: "cron", spec: "30 2 * * *" });
    expect(job.background).toBe(true);
    expect(await job.run(ctx())).toEqual({ status: "SUCCEEDED" });
    expect(cutoffs).toHaveLength(3);
    expect(cutoffs[0].toISOString()).toBe("2026-09-16T00:00:00.000Z");
  });

  it("yields between batches when another job needs the engine", async () => {
    let calls = 0;
    const job = intradayRetentionJob({ retentionDays: 30, deleteOlderThan: async () => { calls += 1; return 10; }, batchSize: 10 });
    expect(await job.run(ctx(() => true))).toEqual({ status: "YIELDED" });
    expect(calls).toBe(1);
  });
});
