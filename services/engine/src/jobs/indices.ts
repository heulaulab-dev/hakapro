// Index EOD (§5.3, §5.11 item 3): one TradingView `global/scan` for IHSG, LQ45, IDX30 and the IDX-IC sector indices
// after the close → index_daily. IHSG also arrives from Yahoo `^JKSE` (daily job and backfill) as the fallback.
import { round, upsertIndexDaily, type IndexDailyUpsert } from "../db/ingest";
import type { JobDefinition } from "../schedule/scheduler";
import { sessionFinal, wibToday } from "../sources/session";
import { impliedPreviousClose, INDEX_SCAN_URL, indexScanBody, parseIndexScan, type TvIndexRow } from "../sources/tradingview";
import { fetchFor, parseDocument, provenanceOf, type JobServices, type SourceRef } from "./common";
import { DEFAULT_TV_DELAY_SECONDS, scanDelaySeconds, UNIVERSE_CRON } from "./universe";

export function tvIndexDailyRows(rows: TvIndexRow[], date: string): IndexDailyUpsert[] {
  return rows.filter((row) => row.close !== null).map((row) => ({
    code: row.code, date, name: row.name, open: row.open, high: row.high, low: row.low, close: round(row.close!, 4),
    previousClose: impliedPreviousClose(row.close, row.changePercent, 3), changePercent: row.changePercent,
  }));
}

export function indicesEodJob(services: JobServices, source: SourceRef): JobDefinition {
  return {
    id: "indices-eod",
    sourceId: source.id,
    trigger: { kind: "cron", spec: UNIVERSE_CRON, tradingDaysOnly: true },
    async run(ctx) {
      const now = services.now();
      const result = await fetchFor(services, ctx, source, INDEX_SCAN_URL, { method: "POST", body: indexScanBody(), headers: { "content-type": "application/json" } });
      const rows = await parseDocument(services, result, parseIndexScan);
      const dataTime = new Date(now.getTime() - (rows.length ? scanDelaySeconds(rows) : DEFAULT_TV_DELAY_SECONDS) * 1000);
      if (!(sessionFinal(dataTime) && wibToday(dataTime) === wibToday(now))) {
        services.log.info("indices_eod_not_final", { job: ctx.jobId });
        return;
      }
      ctx.report.rows(await upsertIndexDaily(services.db, tvIndexDailyRows(rows, wibToday(now)), provenanceOf(result), { primary: true }));
    },
  };
}
