import { z } from "zod";
import { nullLogger, type Logger } from "../log";
import { idxBeiCompanySnapshotSchema, type IdxBeiCompanySnapshot } from "./idx-bei-companies";

/** Source id of the private IDX-BEI microservice (provenance on stored rows, source health, user-facing label). */
export const IDX_BEI_SOURCE_ID = "idx-bei-api";
export const IDX_BEI_INVENTORY_PATH = "/api/system/ingestion-status";
/** Static file the service mounts under /data. Unlike /api/companies it keeps the snapshot's `last_updated`. */
export const IDX_BEI_COMPANY_SNAPSHOT_PATH = "/data/network_alpha_data.json";

const partition = z.object({ total_dates: z.number().int().nonnegative(), start_date: z.string().nullable(), end_date: z.string().nullable() });
export const idxBeiInventorySchema = z.object({
  status: z.string(), health_score: z.number().finite(),
  inventory: z.object({ timeseries: z.object({ stock_summary: partition, broker_summary: partition, index_summary: partition }) }),
});
export type IdxBeiInventory = z.infer<typeof idxBeiInventorySchema>;
export type IdxBeiResult = { status: "AVAILABLE" | "STALE"; source: "idx-bei-api"; checkedAt: string; data: IdxBeiInventory } | { status: "DISABLED" | "UNAVAILABLE"; source: "idx-bei-api"; checkedAt: null; data: null };

export type IdxBeiRead<T> = { ok: true; data: T } | { ok: false; reason: string };

const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const INVENTORY_MAX_BYTES = 1_000_000;
/** The 973-company snapshot is ~3 MB; anything far beyond that is not the file we validated. */
const SNAPSHOT_MAX_BYTES = 16_000_000;
const SNAPSHOT_TIMEOUT_MS = 30_000;
/** Consecutive failures that open the circuit, and how long it stays open before one trial read. */
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 5 * 60_000;

/**
 * Server-controlled, fixed-path, read-only client. Never forwards user URLs and never calls any write or trigger
 * endpoint of the source. Every read is bounded: per-attempt timeout, a byte cap,
 * a few attempts with backoff on transient failures only, and a circuit breaker so an outage costs one probe per
 * cooldown instead of a request per caller.
 */
export class IdxBeiApi {
  private lastGood: { checkedAt: string; data: IdxBeiInventory } | null = null;
  private failures = 0;
  private openUntil = 0;
  private readonly base: string;
  constructor(private readonly options: {
    enabled: boolean; baseUrl: string; fetch?: (url: string, init: RequestInit) => Promise<Response>; timeoutMs?: number; log?: Logger;
    /** Attempts per read (first try included). */
    maxAttempts?: number; backoffMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void>;
  }) {
    const url = new URL(options.baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Invalid IDX_BEI_API_URL");
    this.base = url.origin;
  }

  get enabled() { return this.options.enabled; }

  async inventory(): Promise<IdxBeiResult> {
    const source = IDX_BEI_SOURCE_ID;
    if (!this.options.enabled) return { status: "DISABLED", source, checkedAt: null, data: null };
    const read = await this.readJson(IDX_BEI_INVENTORY_PATH, idxBeiInventorySchema, { timeoutMs: this.options.timeoutMs ?? 5000, maxBytes: INVENTORY_MAX_BYTES });
    if (read.ok) {
      this.lastGood = { checkedAt: new Date().toISOString(), data: read.data };
      this.log.info("idx_bei_inventory_read", { indexDates: read.data.inventory.timeseries.index_summary.total_dates });
      return { status: "AVAILABLE", source, ...this.lastGood };
    }
    return this.lastGood ? { status: "STALE", source, ...this.lastGood } : { status: "UNAVAILABLE", source, checkedAt: null, data: null };
  }

  /** Company reference snapshot (classification, board, shareholders, subsidiaries) with its own capture time. */
  async companySnapshot(): Promise<IdxBeiRead<IdxBeiCompanySnapshot>> {
    if (!this.options.enabled) return { ok: false, reason: "disabled" };
    return this.readJson(IDX_BEI_COMPANY_SNAPSHOT_PATH, idxBeiCompanySnapshotSchema, { timeoutMs: this.options.timeoutMs ?? SNAPSHOT_TIMEOUT_MS, maxBytes: SNAPSHOT_MAX_BYTES });
  }

  private get log() { return this.options.log ?? nullLogger; }
  private now() { return (this.options.now ?? Date.now)(); }

  private async readJson<T extends z.ZodType>(path: string, schema: T, limits: { timeoutMs: number; maxBytes: number }): Promise<IdxBeiRead<z.infer<T>>> {
    if (this.now() < this.openUntil) return { ok: false, reason: "circuit-open" };
    const attempts = Math.max(1, this.options.maxAttempts ?? 2);
    const backoff = this.options.backoffMs ?? 250;
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let reason = "unknown";
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(backoff * 2 ** (attempt - 1));
      let retryable = false;
      try {
        const response = await (this.options.fetch ?? fetch)(`${this.base}${path}`, { redirect: "error", signal: AbortSignal.timeout(limits.timeoutMs), headers: { accept: "application/json" } });
        if (!response.ok) {
          reason = `http-${response.status}`;
          retryable = RETRY_STATUSES.has(response.status);
          this.log.warn("idx_bei_http_failure", { path, status: response.status, attempt });
        } else if (!response.headers.get("content-type")?.includes("application/json")) {
          reason = "not-json";
        } else if (Number(response.headers.get("content-length") ?? 0) > limits.maxBytes) {
          reason = "too-large";
        } else {
          const body = await response.text();
          if (body.length > limits.maxBytes) reason = "too-large";
          else {
            const parsed = schema.safeParse(JSON.parse(body));
            if (parsed.success) { this.failures = 0; return { ok: true, data: parsed.data }; }
            reason = "invalid-schema";
            this.log.warn("idx_bei_schema_rejected", { path, issues: parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") });
          }
        }
      } catch (error) {
        // Network errors and timeouts are transient; a JSON syntax error is not.
        retryable = !(error instanceof SyntaxError);
        reason = error instanceof SyntaxError ? "invalid-json" : "network";
        this.log.warn("idx_bei_read_failed", { path, attempt, error: error instanceof Error ? error.name : "unknown" });
      }
      if (!retryable) break;
    }
    if (++this.failures >= BREAKER_THRESHOLD) {
      this.openUntil = this.now() + BREAKER_COOLDOWN_MS;
      this.failures = 0;
      this.log.warn("idx_bei_circuit_open", { path, reason, cooldownMs: BREAKER_COOLDOWN_MS });
    }
    return { ok: false, reason };
  }
}
