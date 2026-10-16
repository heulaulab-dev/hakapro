import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir, wib } from "../../test/support";
import { SourceBlockedError } from "../fetch/fetcher";
import { MemoryCursorStore, MemoryRunRecorder, MemorySourceStateStore } from "../fetch/stores";
import { cronMatches, parseCron, wibTime } from "./cron";
import { PauseGuard } from "./pause";
import { Scheduler, type JobContext, type JobDefinition } from "./scheduler";
import { sessionPollDue } from "./windows";

// 2026-10-14 Wed, 2026-10-16 Fri, 2026-10-17 Sat, 2026-08-17 Mon (holiday in idx-calendar).

describe("cron (WIB)", () => {
  it("evaluates on the Jakarta wall clock, not UTC", () => {
    const spec = parseCron("30 16 * * 1-5");
    expect(cronMatches(spec, wibTime(new Date("2026-10-14T09:30:00Z")))).toBe(true); // 16:30 WIB
    expect(cronMatches(spec, wibTime(new Date("2026-10-14T16:30:00Z")))).toBe(false);
  });

  it("supports lists, ranges, steps and Sunday as 7", () => {
    const spec = parseCron("*/10 19-23,0-5 * * *");
    expect(cronMatches(spec, wibTime(wib("2026-10-14", "23:50")))).toBe(true);
    expect(cronMatches(spec, wibTime(wib("2026-10-14", "02:20")))).toBe(true);
    expect(cronMatches(spec, wibTime(wib("2026-10-14", "12:00")))).toBe(false);
    expect(cronMatches(spec, wibTime(wib("2026-10-14", "23:55")))).toBe(false);
    expect(cronMatches(parseCron("0 9 * * 7"), wibTime(wib("2026-10-18", "09:00")))).toBe(true);
  });

  it("rejects malformed specs", () => {
    for (const spec of ["* * * *", "61 * * * *", "*/0 * * * *", "5-1 * * * *"]) expect(() => parseCron(spec)).toThrow();
  });
});

describe("session windows", () => {
  const due = (date: string, time: string, every = 5) => sessionPollDue(wibTime(wib(date, time)), every);

  it("polls Mon–Thu sessions every N minutes, at each start and end, never at lunch", () => {
    expect(due("2026-10-14", "08:55")).toBe(false);
    expect(due("2026-10-14", "09:00")).toBe(true);
    expect(due("2026-10-14", "09:05")).toBe(true);
    expect(due("2026-10-14", "09:03")).toBe(false);
    expect(due("2026-10-14", "12:00")).toBe(true); // session 1 end
    expect(due("2026-10-14", "12:30")).toBe(false); // lunch
    expect(due("2026-10-14", "13:30")).toBe(true);
    expect(due("2026-10-14", "15:45")).toBe(true);
    expect(due("2026-10-14", "15:49")).toBe(true); // session 2 end
    expect(due("2026-10-14", "15:50")).toBe(false);
  });

  it("uses the Friday sessions", () => {
    expect(due("2026-10-16", "11:30")).toBe(true);
    expect(due("2026-10-16", "11:35")).toBe(false);
    expect(due("2026-10-16", "13:30")).toBe(false);
    expect(due("2026-10-16", "14:00")).toBe(true);
    expect(due("2026-10-16", "14:15", 15)).toBe(true);
    expect(due("2026-10-16", "14:10", 15)).toBe(false);
  });

  it("skips weekends and exchange holidays", () => {
    expect(due("2026-10-17", "09:00")).toBe(false);
    expect(due("2026-08-17", "09:00")).toBe(false);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("Scheduler", () => {
  let dir: Awaited<ReturnType<typeof tempDir>>;
  let disk = 50;
  beforeEach(async () => { dir = await tempDir(); disk = 50; });
  afterEach(async () => { await dir.cleanup(); });

  function make(jobs: JobDefinition[]) {
    const pause = new PauseGuard(dir.path, 85, { cacheMs: 0, measure: async () => disk });
    const runs = new MemoryRunRecorder();
    const sourceState = new MemorySourceStateStore();
    const scheduler = new Scheduler({ jobs, pause, runs, cursors: new MemoryCursorStore(), sourceState });
    return { scheduler, pause, runs, sourceState };
  }

  const counter = (id: string, trigger: JobDefinition["trigger"], extra: Partial<JobDefinition> = {}) => {
    const job = { id, trigger, calls: 0, async run() { job.calls += 1; }, ...extra };
    return job;
  };

  it("skips trading-day-only jobs on weekends and holidays", async () => {
    const eod = counter("eod", { kind: "cron", spec: "30 16 * * *", tradingDaysOnly: true });
    const { scheduler } = make([eod]);
    expect(await scheduler.tick(wib("2026-10-17", "16:30"))).toEqual([]);
    expect(await scheduler.tick(wib("2026-08-17", "16:30"))).toEqual([]);
    expect(await scheduler.tick(wib("2026-10-14", "16:30"))).toEqual(["eod"]);
    await scheduler.waitFor("eod");
    expect(eod.calls).toBe(1);
  });

  it("fires once per matching minute", async () => {
    const job = counter("ref", { kind: "cron", spec: "0 6 * * *" });
    const { scheduler } = make([job]);
    expect(await scheduler.tick(wib("2026-10-14", "06:00"))).toEqual(["ref"]);
    await scheduler.waitFor("ref");
    expect(await scheduler.tick(new Date(wib("2026-10-14", "06:00").getTime() + 20_000))).toEqual([]);
  });

  it("is single-flight per job", async () => {
    const gate = deferred();
    let calls = 0;
    const { scheduler } = make([{ id: "slow", trigger: { kind: "cron", spec: "* * * * *" }, run: async () => { calls += 1; await gate.promise; } }]);
    expect(await scheduler.tick(wib("2026-10-14", "10:00"))).toEqual(["slow"]);
    expect(await scheduler.tick(wib("2026-10-14", "10:01"))).toEqual([]);
    expect(await scheduler.trigger("slow")).toEqual({ status: "already_running" });
    gate.resolve();
    await scheduler.waitFor("slow");
    expect(calls).toBe(1);
  });

  it("pauses globally above the disk threshold", async () => {
    const job = counter("eod", { kind: "cron", spec: "* * * * *" });
    const { scheduler } = make([job]);
    disk = 86;
    expect(await scheduler.tick(wib("2026-10-14", "16:30"))).toEqual([]);
    expect(await scheduler.trigger("eod")).toEqual({ status: "paused", reason: "disk" });
    disk = 85;
    expect(await scheduler.tick(wib("2026-10-14", "16:31"))).toEqual(["eod"]);
  });

  it("pauses on the build/maintenance flag", async () => {
    const job = counter("intraday", { kind: "session", everyMinutes: 5 });
    const { scheduler, pause } = make([job]);
    await pause.setFlag(true, "coolify build");
    expect(await scheduler.tick(wib("2026-10-14", "09:05"))).toEqual([]);
    await pause.setFlag(false);
    expect(await scheduler.tick(wib("2026-10-14", "09:10"))).toEqual(["intraday"]);
  });

  it("runs session jobs only inside session windows", async () => {
    const job = counter("intraday", { kind: "session", everyMinutes: 5 });
    const { scheduler } = make([job]);
    expect(await scheduler.tick(wib("2026-10-14", "12:30"))).toEqual([]);
    expect(await scheduler.tick(wib("2026-10-14", "13:30"))).toEqual(["intraday"]);
  });

  it("manual trigger bypasses the calendar but not blocks", async () => {
    const job = counter("eod", { kind: "cron", spec: "30 16 * * *", tradingDaysOnly: true }, { sourceId: "fixture" });
    const { scheduler, sourceState, runs } = make([job]);
    const outcome = await scheduler.trigger("eod");
    expect(outcome.status).toBe("started");
    await scheduler.waitFor("eod");
    expect([...runs.runs.values()][0]).toMatchObject({ jobId: "eod", trigger: "manual", status: "SUCCEEDED" });
    await sourceState.markBlocked("fixture", { reason: "RATE_LIMITED", url: "x", status: 429, markers: [], headers: {}, detectedAt: new Date().toISOString() });
    expect(await scheduler.trigger("eod")).toEqual({ status: "blocked" });
    expect(await scheduler.trigger("nope")).toEqual({ status: "unknown_job" });
  });

  it("records BLOCKED runs when a job hits a block", async () => {
    const { scheduler, runs } = make([{ id: "j", sourceId: "s", trigger: { kind: "cron", spec: "0 0 1 1 *" }, run: async () => { throw new SourceBlockedError("s", null); } }]);
    await scheduler.trigger("j");
    await scheduler.waitFor("j");
    expect([...runs.runs.values()][0].status).toBe("BLOCKED");
  });

  it("keeps background jobs from starting while a foreground job runs, and makes running ones yield", async () => {
    const eodGate = deferred();
    const backfillStarted = deferred();
    let yielded = false;
    let eodGateNow = eodGate.promise;
    const eod: JobDefinition = { id: "eod", trigger: { kind: "cron", spec: "30 16 * * *" }, run: async () => { await eodGateNow; } };
    const backfill: JobDefinition = {
      id: "backfill", background: true, trigger: { kind: "cron", spec: "*/10 * * * *" },
      async run(ctx: JobContext) {
        backfillStarted.resolve();
        for (let i = 0; i < 1000; i += 1) {
          if (ctx.shouldYield()) { yielded = true; return { status: "YIELDED" }; }
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      },
    };
    const { scheduler, runs } = make([eod, backfill]);
    // Same minute: foreground launches first, background is skipped as busy.
    expect(await scheduler.tick(wib("2026-10-14", "16:30"))).toEqual(["eod"]);
    eodGate.resolve();
    await scheduler.waitFor("eod");

    // Background running; a foreground start makes it yield.
    const secondGate = deferred();
    eodGateNow = secondGate.promise;
    expect(await scheduler.tick(wib("2026-10-14", "16:40"))).toEqual(["backfill"]);
    await backfillStarted.promise;
    expect((await scheduler.trigger("eod")).status).toBe("started");
    await scheduler.waitFor("backfill");
    expect(yielded).toBe(true);
    expect([...runs.runs.values()].find((run) => run.jobId === "backfill")?.status).toBe("YIELDED");
    secondGate.resolve();
    await scheduler.waitFor("eod");
  });

  it("rejects duplicate job ids", () => {
    const job = counter("a", { kind: "cron", spec: "* * * * *" });
    expect(() => make([job, { ...job }])).toThrow(/Duplicate/);
  });
});

describe("PauseGuard", () => {
  it("pauses when the disk cannot be measured", async () => {
    const dir = await tempDir();
    const guard = new PauseGuard(dir.path, 85, { cacheMs: 0, measure: async () => { throw new Error("statfs failed"); } });
    expect((await guard.check()).paused).toBe(true);
    await dir.cleanup();
  });

  it("measures the real data volume with statfs", async () => {
    const dir = await tempDir();
    const state = await new PauseGuard(dir.path, 100, { cacheMs: 0 }).check();
    expect(state.diskPercent).toBeGreaterThanOrEqual(0);
    expect(state.diskPercent).toBeLessThanOrEqual(100);
    await dir.cleanup();
  });
});
