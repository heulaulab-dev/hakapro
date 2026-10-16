// Source and job registry. The production registry (src/engine.ts defaultRegistry) wires the E2/E2b sources in
// src/sources/ and the jobs in src/jobs/; tests also wire a local fixture source (test/fixture-source.ts).
import type { HostPolicy } from "./fetch/rate-limit";
import type { JobDefinition } from "./schedule/scheduler";

export type SourceKind = "eod" | "intraday" | "reference" | "disclosure" | "news";

export type SourceDefinition = {
  id: string;
  host: string;
  kind: SourceKind;
  policy: HostPolicy;
  description?: string;
};

export type Registry = { sources: SourceDefinition[]; jobs: JobDefinition[] };

/** Intraday polling keeps one request in flight per host (§8.3), whatever the base policy says. */
export function defineSource(source: SourceDefinition): SourceDefinition {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(source.id)) throw new Error(`Invalid source id: ${source.id}`);
  return source.kind === "intraday" ? { ...source, policy: { ...source.policy, concurrency: 1 } } : source;
}

export function validateRegistry(registry: Registry): Registry {
  const ids = new Set<string>();
  for (const source of registry.sources) {
    if (ids.has(source.id)) throw new Error(`Duplicate source id: ${source.id}`);
    ids.add(source.id);
  }
  for (const job of registry.jobs) {
    if (job.sourceId && !ids.has(job.sourceId)) throw new Error(`Job ${job.id} references unknown source ${job.sourceId}`);
  }
  return registry;
}

/** Retention cutoff: rows strictly older than `days` before `now` are pruned. */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/** Daily at 02:30 WIB, outside market hours; deletes in batches and yields to other jobs between batches. */
export function intradayRetentionJob(options: { retentionDays: number; deleteOlderThan: (cutoff: Date, limit: number) => Promise<number>; now?: () => Date; batchSize?: number }): JobDefinition {
  return {
    id: "intraday-retention",
    trigger: { kind: "cron", spec: "30 2 * * *" },
    background: true,
    async run(ctx) {
      const cutoff = retentionCutoff((options.now ?? (() => new Date()))(), options.retentionDays);
      const batch = options.batchSize ?? 5000;
      for (;;) {
        const deleted = await options.deleteOlderThan(cutoff, batch);
        if (deleted < batch) return { status: "SUCCEEDED" };
        if (ctx.shouldYield()) return { status: "YIELDED" };
      }
    },
  };
}
