import { z } from "zod";
import { nullLogger, type Logger } from "../log";

const partition = z.object({ total_dates: z.number().int().nonnegative(), start_date: z.string().nullable(), end_date: z.string().nullable() });
export const idxBeiInventorySchema = z.object({
  status: z.string(), health_score: z.number().finite(),
  inventory: z.object({ timeseries: z.object({ stock_summary: partition, broker_summary: partition, index_summary: partition }) }),
});
export type IdxBeiInventory = z.infer<typeof idxBeiInventorySchema>;
export type IdxBeiResult = { status: "AVAILABLE" | "STALE"; source: "idx-bei-api"; checkedAt: string; data: IdxBeiInventory } | { status: "DISABLED" | "UNAVAILABLE"; source: "idx-bei-api"; checkedAt: null; data: null };

/** Server-controlled, fixed-path, read-only client. Never forwards user URLs or source mutation endpoints. */
export class IdxBeiApi {
  private lastGood: { checkedAt: string; data: IdxBeiInventory } | null = null;
  private readonly base: string;
  constructor(private readonly options: { enabled: boolean; baseUrl: string; fetch?: (url: string, init: RequestInit) => Promise<Response>; timeoutMs?: number; log?: Logger }) {
    const url = new URL(options.baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Invalid IDX_BEI_API_URL");
    this.base = url.origin;
  }
  async inventory(): Promise<IdxBeiResult> {
    const source = "idx-bei-api" as const;
    if (!this.options.enabled) return { status: "DISABLED", source, checkedAt: null, data: null };
    const log = this.options.log ?? nullLogger;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await (this.options.fetch ?? fetch)(`${this.base}/api/system/ingestion-status`, { redirect: "error", signal: AbortSignal.timeout(this.options.timeoutMs ?? 5000), headers: { accept: "application/json" } });
        if (!response.ok) {
          log.warn("idx_bei_http_failure", { status: response.status, attempt });
          if (attempt === 0 && [429, 502, 503, 504].includes(response.status)) { await new Promise(resolve => setTimeout(resolve, 250)); continue; }
          break;
        }
        if (!response.headers.get("content-type")?.includes("application/json")) break;
        const data = idxBeiInventorySchema.parse(await response.json());
        this.lastGood = { checkedAt: new Date().toISOString(), data };
        log.info("idx_bei_inventory_read", { indexDates: data.inventory.timeseries.index_summary.total_dates });
        return { status: "AVAILABLE", source, ...this.lastGood };
      } catch { log.warn("idx_bei_read_failed", { attempt }); break; }
    }
    return this.lastGood ? { status: "STALE", source, ...this.lastGood } : { status: "UNAVAILABLE", source, checkedAt: null, data: null };
  }
}
