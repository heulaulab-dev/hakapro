// Macro (E3, §5.8, §5.11 item 5): Bank Indonesia's BI-Rate and JISDOR pages, daily. Only the first table page (the
// most recent 10 rows) is read; there is no ASP.NET postback paging. JISDOR is fixed in the morning of each BI
// business day, so 17:00 WIB catches the day's row; BI-Rate changes only after Board of Governors meetings.
import { upsertMacro } from "../db/market-info";
import type { JobDefinition } from "../schedule/scheduler";
import { BI_RATE_URL, JISDOR_URL, parseBiRate, parseJisdor, type MacroRow } from "../sources/bi";
import { fetchFor, parseDocument, provenanceOf, type JobServices, type SourceRef } from "./common";

export const JISDOR_CRON = "0 17 * * *";
export const BI_RATE_CRON = "5 17 * * *";
const HTML_ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1";

function biTableJob(id: string, spec: string, url: string, parse: (html: string) => MacroRow[], services: JobServices, source: SourceRef): JobDefinition {
  return {
    id,
    sourceId: source.id,
    trigger: { kind: "cron", spec },
    async run(ctx) {
      const result = await fetchFor(services, ctx, source, url, { accept: HTML_ACCEPT });
      // 304 or identical bytes: those rows are already stored.
      if (result.kind !== "new") return;
      const rows = await parseDocument(services, result, parse);
      ctx.report.rows(await upsertMacro(services.db, rows, provenanceOf(result)));
    },
  };
}

export const jisdorJob = (services: JobServices, source: SourceRef) => biTableJob("macro-jisdor", JISDOR_CRON, JISDOR_URL, parseJisdor, services, source);
export const biRateJob = (services: JobServices, source: SourceRef) => biTableJob("macro-bi-rate", BI_RATE_CRON, BI_RATE_URL, parseBiRate, services, source);
