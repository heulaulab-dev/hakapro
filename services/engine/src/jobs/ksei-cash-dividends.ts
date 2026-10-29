import type { EngineDb } from "../db/client";
import { storeKseiCashDividendNotice } from "../db/ksei-cash-dividends";
import type { Fetcher } from "../fetch/fetcher";
import type { SourceStateStore } from "../fetch/stores";
import type { Logger } from "../log";
import type { JobDefinition } from "../schedule/scheduler";
import { parseKseiCashDividendPdf, parseKseiCashDividendSchedule } from "../sources/ksei-cash-dividend";

export const KSEI_CASH_DIVIDEND_SOURCE_ID = "ksei-cash-dividend";
export const KSEI_CASH_DIVIDEND_SCHEDULE_URL = "https://web.ksei.co.id/publications/corporate-action-schedules/cash-dividend";
const SOURCE = { id: KSEI_CASH_DIVIDEND_SOURCE_ID, policy: { minIntervalMs: 5000, concurrency: 1 } };

export function kseiCashDividendsJob(services: {
  db: EngineDb; fetcher: Fetcher; documents: { setParseStatus(id: string, status: "PARSED" | "FAILED" | "SKIPPED", error?: string | null): Promise<void> };
  sourceState: SourceStateStore; log: Logger; now: () => Date;
}, hooks: { urls?: () => Promise<string[]>; persist?: typeof storeKseiCashDividendNotice } = {}): JobDefinition {
  const persist = hooks.persist ?? storeKseiCashDividendNotice;
  return {
    id: "ksei-cash-dividends", sourceId: KSEI_CASH_DIVIDEND_SOURCE_ID,
    trigger: { kind: "cron", spec: "15 */6 * * *" }, background: true,
    async run(ctx) {
      try {
        let links: string[];
        if (hooks.urls) links = await hooks.urls();
        else {
          const page = await services.fetcher.fetch(SOURCE, KSEI_CASH_DIVIDEND_SCHEDULE_URL, { accept: "text/html", fetchRunId: ctx.runId });
          ctx.report.document(page.kind === "new");
          links = parseKseiCashDividendSchedule(await page.text()).slice(0, 30);
        }
        let inserted = 0;
        for (const url of links) {
          if (ctx.shouldYield()) return { status: "YIELDED" };
          const fetched = await services.fetcher.fetch(SOURCE, url, { accept: "application/pdf", fetchRunId: ctx.runId });
          ctx.report.document(fetched.kind === "new");
          try {
            const notice = await parseKseiCashDividendPdf(await fetched.body(), url);
            const wasInserted = await persist(services.db, notice, fetched.document.sha256, fetched.document.id, fetched.document.fetchedAt);
            if (fetched.kind === "new") await services.documents.setParseStatus(fetched.document.id, "PARSED");
            if (wasInserted) inserted++;
          } catch (error) {
            if (fetched.kind === "new") await services.documents.setParseStatus(fetched.document.id, "FAILED", error instanceof Error ? error.message.slice(0, 500) : "KSEI PDF parse failed");
            throw error;
          }
        }
        ctx.report.rows(inserted);
        await services.sourceState.recordSuccess(KSEI_CASH_DIVIDEND_SOURCE_ID, inserted);
        services.log.info("ksei_cash_dividends_imported", { fetched: links.length, inserted });
        return { status: "SUCCEEDED" };
      } catch (error) {
        await services.sourceState.recordError(KSEI_CASH_DIVIDEND_SOURCE_ID, error instanceof Error ? error.message : "KSEI import failed").catch(() => {});
        services.log.error("ksei_cash_dividend_import_failed", { message: error instanceof Error ? error.message : "KSEI import failed" });
        throw error;
      }
    },
  };
}
