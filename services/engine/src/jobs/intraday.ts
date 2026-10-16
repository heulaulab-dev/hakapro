// Intraday snapshots (E2b, §8.3, §5.10): inside IDX session windows, every ENGINE_INTRADAY_INTERVAL_MINUTES (default 5,
// never under 1), one TradingView `indonesia/scan` for the whole market plus one `global/scan` for the indices.
// Rows are stamped with the data time (fetch time minus the stated delay) and served as DELAYED, never LIVE.
// A cached, byte-identical response adds nothing: the previous snapshot already holds that data.
import { insertIndexIntraday, insertIntradaySnapshot } from "../db/ingest";
import type { JobDefinition } from "../schedule/scheduler";
import { impliedPreviousClose, INDEX_SCAN_URL, indexScanBody, parseIndexScan } from "../sources/tradingview";
import { fetchFor, parseDocument, provenanceOf, type JobServices, type SourceRef } from "./common";
import { scanDelaySeconds, scanMarket } from "./universe";

export function intradayJob(services: JobServices, source: SourceRef, everyMinutes: number): JobDefinition {
  return {
    id: "intraday",
    sourceId: source.id,
    trigger: { kind: "session", everyMinutes: Math.max(1, everyMinutes) },
    async run(ctx) {
      const now = services.now();
      const pages = await scanMarket(services, ctx, source);
      const rows = pages.flatMap((page) => page.rows);
      const ts = new Date(now.getTime() - scanDelaySeconds(rows) * 1000);
      for (const page of pages) {
        if (page.result.kind !== "new") continue;
        ctx.report.rows(await insertIntradaySnapshot(services.db, ts, page.rows.filter((row) => row.close !== null).map((row) => {
          const previous = impliedPreviousClose(row.close, row.changePercent);
          return {
            symbol: row.symbol, last: row.close, open: row.open, high: row.high, low: row.low,
            change: previous === null ? null : row.close! - previous, changePercent: row.changePercent,
            volume: row.volume === null ? null : Math.round(row.volume), value: row.value === null ? null : Math.round(row.value),
          };
        }), provenanceOf(page.result)));
      }
      if (ctx.shouldYield()) return { status: "YIELDED" };

      const indices = await fetchFor(services, ctx, source, INDEX_SCAN_URL, { method: "POST", body: indexScanBody(), headers: { "content-type": "application/json" } });
      if (indices.kind !== "new") return;
      const indexRows = await parseDocument(services, indices, parseIndexScan);
      const indexTs = new Date(now.getTime() - (indexRows.length ? scanDelaySeconds(indexRows) : scanDelaySeconds(rows)) * 1000);
      ctx.report.rows(await insertIndexIntraday(services.db, indexTs, indexRows.filter((row) => row.close !== null).map((row) => ({
        code: row.code, name: row.name, last: row.close!, open: row.open, high: row.high, low: row.low, changePercent: row.changePercent,
      })), provenanceOf(indices)));
    },
  };
}
