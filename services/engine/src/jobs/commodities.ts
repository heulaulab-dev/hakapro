// Commodities (E3): the World Bank "Pink Sheet" monthly workbook (DATA-ENGINE.md §5; sources/worldbank.ts). The
// World Bank releases the file early each month; this runs on the 4th at 06:30 WIB. The file URL carries a per-release
// hash, so the job first reads the landing page to find the current workbook URL, then fetches and parses the XLSX.
// An unchanged workbook (304 or identical bytes) is skipped. Kept commodities drive IDX sectors (coal, CPO, nickel …).
import { upsertMacro } from "../db/market-info";
import type { JobDefinition } from "../schedule/scheduler";
import { findPinkSheetUrl, parsePinkSheet, WORLD_BANK_LANDING_URL } from "../sources/worldbank";
import { fetchFor, provenanceOf, type JobServices, type SourceRef } from "./common";

export const COMMODITIES_CRON = "30 6 4 * *";
const HTML_ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1";
const XLSX_ACCEPT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream;q=0.9,*/*;q=0.1";

export function commoditiesJob(services: JobServices, source: SourceRef): JobDefinition {
  return {
    id: "macro-commodities",
    sourceId: source.id,
    trigger: { kind: "cron", spec: COMMODITIES_CRON },
    async run(ctx) {
      // 1. Discover the current workbook URL from the landing page (its path carries a release hash).
      const landing = await fetchFor(services, ctx, source, WORLD_BANK_LANDING_URL, { accept: HTML_ACCEPT });
      const fileUrl = findPinkSheetUrl(await landing.text());
      // 2. Fetch the workbook; identical bytes (304/duplicate) mean the stored month is already parsed.
      const workbook = await fetchFor(services, ctx, source, fileUrl, { accept: XLSX_ACCEPT });
      if (workbook.kind !== "new") return;
      // 3. Parse the binary workbook; record PARSED/FAILED on the raw document like parseDocument does for text.
      try {
        const rows = parsePinkSheet(await workbook.body());
        await services.documents.setParseStatus(workbook.document.id, "PARSED");
        ctx.report.rows(await upsertMacro(services.db, rows, provenanceOf(workbook)));
      } catch (error) {
        await services.documents.setParseStatus(workbook.document.id, "FAILED", error instanceof Error ? error.message.slice(0, 500) : "parse failed");
        throw error;
      }
    },
  };
}
