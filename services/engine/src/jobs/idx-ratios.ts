// Historical IDX ratios are replayed by period through the shared item cursor and idempotent period upserts.
import type { EngineDb } from "../db/client";
import { upsertIdxRatioPeriods, upsertIdxStockRatios } from "../db/idx-ratios";
import type { Provenance } from "../db/ingest";
import { itemBackfillJob } from "../schedule/backfill";
import type { JobDefinition } from "../schedule/scheduler";
import { fetchIdxRatioPage, parseIdxRatioPage, type IdxPeriodType, type IdxRatioPeriod, type IdxRatioRequest } from "../sources/idx-ratios";
import type { IdxJsonTransport } from "../sources/idx-primary";
import type { JobServices, SourceRef } from "./common";

export const IDX_RATIOS_JOB_ID = "idx-ratios-backfill";
const PAGE_SIZE = 100;
const MAX_PAGES_PER_PERIOD = 250;
export function idxRatioPeriods(fromYear = 2020, throughYear = new Date().getUTCFullYear()): string[] {
  const periods: string[] = [];
  for (let year = fromYear; year <= throughYear; year += 1) {
    periods.push(`${year}:annual:4`);
    for (const quarter of [1, 2, 3, 4]) periods.push(`${year}:quarterly:${quarter}`);
  }
  return periods;
}
function parsePeriod(item: string): Pick<IdxRatioRequest, "year" | "quarter" | "periodType"> {
  const [yearText, type, quarterText] = item.split(":");
  const year = Number(yearText); const quarter = Number(quarterText);
  if (!Number.isInteger(year) || (type !== "annual" && type !== "quarterly") || ![1, 2, 3, 4].includes(quarter)) throw new Error(`invalid IDX ratio period cursor: ${item}`);
  return { year, periodType: type as IdxPeriodType, quarter: quarter as 1 | 2 | 3 | 4 };
}

export function idxRatiosBackfillJob(
  services: JobServices,
  source: SourceRef,
  transport: IdxJsonTransport,
  options: { fromYear?: number; throughYear?: number; batchSize?: number; items?: string[]; persistPeriods?: (db: EngineDb, rows: IdxRatioPeriod[], provenance: Provenance) => Promise<number>; persistLatest?: (db: EngineDb, rows: IdxRatioPeriod[], provenance: Provenance) => Promise<number> } = {},
): JobDefinition {
  const persistPeriods = options.persistPeriods ?? upsertIdxRatioPeriods;
  const persistLatest = options.persistLatest ?? upsertIdxStockRatios;
  return itemBackfillJob({
    id: IDX_RATIOS_JOB_ID, sourceId: source.id, from: "idx-ratios-v1", batchSize: options.batchSize ?? 2,
    items: async () => options.items ?? idxRatioPeriods(options.fromYear, options.throughYear),
    async processItem(item) {
      const period = parsePeriod(item);
      let pageNumber = 1;
      let totalRecords: number | null = null;
      let rowsSaved = 0;
      const seenPages = new Set<string>();
      while (pageNumber <= MAX_PAGES_PER_PERIOD) {
        const request = { ...period, page: pageNumber, pageSize: PAGE_SIZE };
        const fetched = await fetchIdxRatioPage(transport, request);
        if (!fetched.ok) throw new Error(`IDX ratio period ${item} page ${pageNumber} unavailable: ${fetched.reason}`);
        const parsed = parseIdxRatioPage(fetched.body, period);
        if (parsed.rejected.length) services.log.info("idx_ratio_rows_rejected", { job: IDX_RATIOS_JOB_ID, period: item, page: pageNumber, rejected: parsed.rejected.length });
        totalRecords = parsed.totalRecords ?? totalRecords;
        if (parsed.rows.length === 0) {
          const expectedRecordsRemain = totalRecords !== null && (pageNumber - 1) * PAGE_SIZE < totalRecords;
          if (expectedRecordsRemain) throw new Error(`IDX ratios returned an empty page ${pageNumber} while ${totalRecords} records are reported for ${item}`);
          break;
        }
        const signature = parsed.rows.map((row) => `${row.symbol}:${row.fsDate}`).join("|");
        if (seenPages.has(signature)) throw new Error(`IDX ratios repeated page ${pageNumber} for ${item}`);
        seenPages.add(signature);
        const provenance = { source: source.id, asOf: services.now(), rawRef: null };
        rowsSaved += await persistPeriods(services.db, parsed.rows, provenance);
        await persistLatest(services.db, parsed.rows, provenance);
        const reportedRecordsRemain = totalRecords !== null && pageNumber * PAGE_SIZE < totalRecords;
        if (reportedRecordsRemain && parsed.rows.length < PAGE_SIZE) {
          throw new Error(`IDX ratios returned a short page ${pageNumber} while ${totalRecords} records are reported for ${item}`);
        }
        if (totalRecords === null && parsed.rows.length < PAGE_SIZE) break;
        if (totalRecords !== null && !reportedRecordsRemain) break;
        pageNumber += 1;
      }
      if (pageNumber > MAX_PAGES_PER_PERIOD) throw new Error(`IDX ratio period ${item} exceeded ${MAX_PAGES_PER_PERIOD} pages`);
      return { rows: rowsSaved };
    },
  });
}
