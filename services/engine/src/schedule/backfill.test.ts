import { describe, expect, it } from "vitest";
import { MemoryCursorStore } from "../fetch/stores";
import { BACKFILL_START, backfillJob } from "./backfill";
import type { JobContext } from "./scheduler";

function context(cursors: MemoryCursorStore, jobId: string, shouldYield = () => false): JobContext & { rows: number } {
  const ctx = {
    rows: 0, runId: "r", jobId, trigger: "schedule" as const, startedAt: new Date(), shouldYield,
    cursor: { get: () => cursors.get(jobId), set: (value: Record<string, unknown>) => cursors.set(jobId, value) },
    report: { document: () => {}, rows: (n: number) => { ctx.rows += n; } },
  };
  return ctx;
}

describe("backfillJob", () => {
  it("starts at 2020-01-01, fetches trading days only, in small batches, and resumes from the stored cursor", async () => {
    const seen: string[] = [];
    const cursors = new MemoryCursorStore();
    const job = backfillJob({ id: "eod-backfill", sourceId: "s", until: () => "2020-01-15", batchDays: 3, processDay: async (date) => { seen.push(date); return { rows: 10 }; } });
    expect(BACKFILL_START).toBe("2020-01-01");
    expect(job.background).toBe(true);
    expect(job.trigger).toEqual({ kind: "cron", spec: "*/10 19-23,0-5 * * *" });

    await job.run(context(cursors, job.id));
    // 2020-01-01 (Wed) is not in the 2026-only holiday list, so it counts as a trading day here.
    expect(seen).toEqual(["2020-01-01", "2020-01-02", "2020-01-03"]);
    expect(await cursors.get(job.id)).toMatchObject({ next: "2020-01-04" });

    await job.run(context(cursors, job.id));
    expect(seen.slice(3)).toEqual(["2020-01-06", "2020-01-07", "2020-01-08"]); // weekend skipped
  });

  it("stops before `until` (the daily job's territory) and yields when asked", async () => {
    const cursors = new MemoryCursorStore();
    await cursors.set("b", { next: "2020-01-13" });
    const seen: string[] = [];
    const job = backfillJob({ id: "b", sourceId: "s", until: () => "2020-01-15", batchDays: 10, processDay: async (date) => { seen.push(date); return { rows: 1 }; } });
    await job.run(context(cursors, "b"));
    expect(seen).toEqual(["2020-01-13", "2020-01-14"]);

    let calls = 0;
    const yielding = backfillJob({ id: "y", sourceId: "s", until: () => "2021-01-01", processDay: async () => { calls += 1; return { rows: 1 }; } });
    expect(await yielding.run(context(cursors, "y", () => true))).toEqual({ status: "YIELDED" });
    expect(calls).toBe(0);
  });
});
