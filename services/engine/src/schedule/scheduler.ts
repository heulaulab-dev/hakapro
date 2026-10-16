// In-process scheduler (§3/§4). Jobs are single-flight, evaluated on the WIB wall clock, skip non-trading days
// where asked, and never start while the global pause is on. Background jobs (backfills) yield to every other job.
import { isTradingDay } from "@/lib/freshness/session";
import { SourceBlockedError } from "../fetch/fetcher";
import type { CursorStore, RunRecorder, RunStatus, RunTotals, SourceStateStore } from "../fetch/stores";
import { nullLogger, type Logger } from "../log";
import { cronMatches, parseCron, wibTime, type CronSpec, type WibTime } from "./cron";
import type { PauseGuard } from "./pause";
import { parseWindow, sessionPollDue, windowPollDue } from "./windows";

export type JobTrigger =
  /** Cron on the WIB clock; `tradingDaysOnly` skips weekends and IDX holidays (EOD jobs). */
  | { kind: "cron"; spec: string; tradingDaysOnly?: boolean }
  /** Every N minutes inside IDX session windows on trading days (intraday polling). */
  | { kind: "session"; everyMinutes: number }
  /** Every N minutes from `from` to `to` (inclusive, HH:MM WIB) on every day, weekends included (news polling). */
  | { kind: "window"; everyMinutes: number; from: string; to: string };

export type JobContext = {
  runId: string;
  jobId: string;
  trigger: "schedule" | "manual";
  startedAt: Date;
  /** True when the job should stop at the next safe point: pause turned on, or (background jobs) another job wants to run. */
  shouldYield(): boolean;
  cursor: { get(): Promise<Record<string, unknown> | null>; set(value: Record<string, unknown>): Promise<void> };
  report: { document(isNew: boolean): void; rows(count: number): void };
};

export type JobResult = { status?: "SUCCEEDED" | "YIELDED" } | void;

export type JobDefinition = {
  id: string;
  sourceId?: string;
  trigger: JobTrigger;
  /** Background jobs never start while a foreground job runs, and see shouldYield() once one does. */
  background?: boolean;
  /**
   * Low-priority background jobs (the fundamentals refresh) also give way to other background jobs (the EOD
   * backfill): they never start while any other job runs, and see shouldYield() as soon as one does.
   */
  lowPriority?: boolean;
  run(ctx: JobContext): Promise<JobResult>;
};

export type TriggerOutcome =
  | { status: "started"; runId: string }
  | { status: "already_running" | "unknown_job" | "blocked" | "busy" }
  | { status: "paused"; reason: string | null };

export type JobStatus = { id: string; sourceId: string | null; trigger: JobTrigger; background: boolean; running: boolean; lastStartedAt: string | null; lastStatus: RunStatus | null; lastError: string | null };

type Compiled = JobDefinition & { cron: CronSpec | null };

export type SchedulerDeps = {
  jobs: JobDefinition[];
  pause: PauseGuard;
  runs: RunRecorder;
  cursors: CursorStore;
  sourceState: SourceStateStore;
  now?: () => Date;
  log?: Logger;
  tickMs?: number;
};

export class Scheduler {
  private readonly jobs = new Map<string, Compiled>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly lastFired = new Map<string, string>();
  private readonly history = new Map<string, { startedAt: string; status: RunStatus | null; error: string | null }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => Date;
  private readonly log: Logger;

  constructor(private readonly deps: SchedulerDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? nullLogger;
    for (const job of deps.jobs) {
      if (this.jobs.has(job.id)) throw new Error(`Duplicate job id: ${job.id}`);
      if (job.trigger.kind !== "cron" && (!Number.isInteger(job.trigger.everyMinutes) || job.trigger.everyMinutes < 1)) throw new Error(`Invalid ${job.trigger.kind} interval for ${job.id}`);
      if (job.trigger.kind === "window") parseWindow(job.trigger.from, job.trigger.to);
      this.jobs.set(job.id, { ...job, cron: job.trigger.kind === "cron" ? parseCron(job.trigger.spec) : null });
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch((error) => this.log.error("scheduler_tick_failed", { message: String(error) })), this.deps.tickMs ?? 15_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Resolves once every running job has finished (or the timeout passes). */
  async drain(timeoutMs = 20_000): Promise<void> {
    await Promise.race([Promise.allSettled([...this.running.values()]), new Promise((resolve) => setTimeout(resolve, timeoutMs).unref?.())]);
  }

  isDue(job: JobDefinition, time: WibTime): boolean {
    const compiled = this.jobs.get(job.id);
    if (!compiled) return false;
    if (compiled.trigger.kind === "session") return sessionPollDue(time, compiled.trigger.everyMinutes);
    if (compiled.trigger.kind === "window") return windowPollDue(time, compiled.trigger);
    if (compiled.trigger.tradingDaysOnly && !isTradingDay(time.date)) return false;
    return cronMatches(compiled.cron!, time);
  }

  /** Evaluates due jobs for the current minute; returns the ids launched. */
  async tick(at: Date = this.now()): Promise<string[]> {
    const time = wibTime(at);
    const minuteKey = `${time.date}T${time.minutes}`;
    const due = [...this.jobs.values()].filter((job) => this.lastFired.get(job.id) !== minuteKey && this.isDue(job, time));
    if (!due.length) return [];
    for (const job of due) this.lastFired.set(job.id, minuteKey);

    const pause = await this.deps.pause.check();
    if (pause.paused) {
      this.log.warn("scheduler_paused", { reason: pause.reason, diskPercent: pause.diskPercent, skipped: due.map((job) => job.id).join(",") });
      return [];
    }
    // Foreground first, so a background job due in the same minute sees them as running.
    const rank = (job: Compiled) => (!job.background ? 0 : job.lowPriority ? 2 : 1);
    const ordered = [...due].sort((a, b) => rank(a) - rank(b));
    const launched: string[] = [];
    for (const job of ordered) {
      const outcome = await this.launch(job, "schedule");
      if (outcome.status === "started") launched.push(job.id);
      else this.log.info("job_skipped", { job: job.id, status: outcome.status });
    }
    return launched;
  }

  async trigger(jobId: string): Promise<TriggerOutcome> {
    const job = this.jobs.get(jobId);
    if (!job) return { status: "unknown_job" };
    const pause = await this.deps.pause.check(true);
    if (pause.paused) return { status: "paused", reason: pause.reason };
    return this.launch(job, "manual");
  }

  private foregroundRunning(): boolean {
    return [...this.running.keys()].some((id) => !this.jobs.get(id)?.background);
  }

  /** Whether `job` must give way: a foreground job runs, or (low priority) any other job runs. */
  private outranked(job: Compiled): boolean {
    if (!job.background) return false;
    if (job.lowPriority) return [...this.running.keys()].some((id) => id !== job.id);
    return this.foregroundRunning();
  }

  private async launch(job: Compiled, trigger: "schedule" | "manual"): Promise<TriggerOutcome> {
    if (this.running.has(job.id)) return { status: "already_running" };
    if (this.outranked(job)) return { status: "busy" };
    if (job.sourceId && (await this.deps.sourceState.isBlocked(job.sourceId))) return { status: "blocked" };

    // Reserve the slot before the first await so a concurrent trigger sees it.
    let release!: () => void;
    this.running.set(job.id, new Promise<void>((resolve) => { release = resolve; }));
    let runId: string;
    try {
      runId = await this.deps.runs.start(job.id, job.sourceId ?? null, trigger);
    } catch (error) {
      this.running.delete(job.id);
      release();
      throw error;
    }
    const startedAt = this.now();
    this.history.set(job.id, { startedAt: startedAt.toISOString(), status: null, error: null });
    void this.execute(job, runId, trigger, startedAt).finally(() => {
      this.running.delete(job.id);
      release();
    });
    return { status: "started", runId };
  }

  private async execute(job: Compiled, runId: string, trigger: "schedule" | "manual", startedAt: Date): Promise<void> {
    const totals: RunTotals = { documentsFetched: 0, documentsNew: 0, rowsIngested: 0 };
    const ctx: JobContext = {
      runId, jobId: job.id, trigger, startedAt,
      shouldYield: () => this.deps.pause.last?.paused === true || this.outranked(job),
      cursor: { get: () => this.deps.cursors.get(job.id), set: (value) => this.deps.cursors.set(job.id, value) },
      report: {
        document: (isNew) => { totals.documentsFetched += 1; if (isNew) totals.documentsNew += 1; },
        rows: (count) => { totals.rowsIngested += count; },
      },
    };
    let status: RunStatus = "SUCCEEDED";
    let error: string | null = null;
    this.log.info("job_started", { job: job.id, runId, trigger });
    try {
      const result = await job.run(ctx);
      if (result?.status === "YIELDED") status = "YIELDED";
      if (job.sourceId) await this.deps.sourceState.recordSuccess(job.sourceId, totals.rowsIngested);
    } catch (caught) {
      status = caught instanceof SourceBlockedError ? "BLOCKED" : "FAILED";
      error = caught instanceof Error ? caught.message : String(caught);
      if (job.sourceId && status === "FAILED") await this.deps.sourceState.recordError(job.sourceId, error).catch(() => {});
      if (status === "BLOCKED") this.log.error("SOURCE_BLOCKED", { job: job.id, source: job.sourceId, message: error });
    }
    this.history.set(job.id, { startedAt: startedAt.toISOString(), status, error });
    await this.deps.runs.finish(runId, { ...totals, status, error }).catch((cause) => this.log.error("run_record_failed", { runId, message: String(cause) }));
    this.log.info("job_finished", { job: job.id, runId, status, rows: totals.rowsIngested, documents: totals.documentsFetched });
  }

  status(): JobStatus[] {
    return [...this.jobs.values()].map((job) => {
      const last = this.history.get(job.id);
      return {
        id: job.id, sourceId: job.sourceId ?? null, trigger: job.trigger, background: job.background === true,
        running: this.running.has(job.id), lastStartedAt: last?.startedAt ?? null, lastStatus: last?.status ?? null, lastError: last?.error ?? null,
      };
    });
  }

  /** Test helper: waits for one job's current run. */
  async waitFor(jobId: string): Promise<void> {
    await this.running.get(jobId);
  }
}
