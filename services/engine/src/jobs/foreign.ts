// Foreign flow from arjum (§8.5c). Nightly after the EOD run: per-stock `/api/history/{code}` (20 sessions per call),
// most liquid first by the latest session's value. Stops at whichever comes first:
//   - ENGINE_ARJUM_DAILY_BUDGET calls made today (WIB), counted in the job cursor across runs and restarts;
//   - the provider's x-ratelimit-remaining below ENGINE_ARJUM_RESERVE (the app environments' share of the quota);
//   - a 429 or auth failure: the fetcher marks arjum BLOCKED and the job stops (no retry, §2).
// Stocks it does not reach keep foreignBuy/foreignSell null for that session.
import { activeSymbols, recordEodSession, symbolsByLiquidity, symbolsWithDaily, symbolsWithForeign, upsertDaily } from "../db/ingest";
import { FetchError } from "../fetch/fetcher";
import type { JobDefinition } from "../schedule/scheduler";
import { historyUrl, parseHistory, quotaRemaining } from "../sources/arjum";
import { jakartaClock } from "@/lib/freshness/session";
import { lastCompletedSession, wibToday } from "../sources/session";
import type { ArjumConfig } from "../config";
import { fetchFor, parseDocument, provenanceOf, type JobServices, type SourceRef } from "./common";

/** 19:00 and 21:00 WIB on trading days; the second run continues within what is left of the budget. */
export const FOREIGN_FLOW_CRON = "0 19,21 * * *";

export type ForeignStop = "done" | "budget" | "reserve" | "yield" | "error";

export function foreignFlowJob(services: JobServices, source: SourceRef, config: Pick<ArjumConfig, "apiKey" | "baseUrl" | "dailyBudget" | "reserve" | "eodEnabled">): JobDefinition {
  return {
    id: "foreign-flow",
    sourceId: source.id,
    trigger: { kind: "cron", spec: FOREIGN_FLOW_CRON, tradingDaysOnly: true },
    async run(ctx) {
      const now = services.now();
      const today = wibToday(now);
      const session = lastCompletedSession(now);
      const saved = await ctx.cursor.get();
      let used = saved?.day === today && typeof saved.used === "number" ? saved.used : 0;
      const have = await symbolsWithForeign(services.db, session);
      const queue = (await symbolsByLiquidity(services.db, session)).filter((symbol) => !have.has(symbol));
      let stop: ForeignStop = "done";
      let remaining: number | null = null;
      let filled = 0;

      for (const symbol of queue) {
        if (used >= config.dailyBudget) { stop = "budget"; break; }
        if (remaining !== null && remaining < config.reserve) { stop = "reserve"; break; }
        if (ctx.shouldYield()) { stop = "yield"; break; }
        used += 1;
        await ctx.cursor.set({ day: today, used, session });
        let result;
        try {
          result = await fetchFor(services, ctx, source, historyUrl(config.baseUrl, symbol), { headers: { "x-api-key": config.apiKey } });
        } catch (error) {
          // 404 is documented for unknown codes: skip it. Anything else (bad request, a provider change) ends the run.
          if (error instanceof FetchError && error.status === 404) continue;
          stop = "error";
          throw error;
        }
        remaining = quotaRemaining(result.headers);
        const sessions = await parseDocument(services, result, (text) => parseHistory(text, symbol));
        const rows = sessions.map((row) => ({ symbol, ...row }));
        // An explicit provider entitlement can promote this response to primary EOD: it includes OHLCV,
        // value, frequency, and foreign flow in one call. Otherwise it only fills missing fallback fields.
        ctx.report.rows(await upsertDaily(services.db, rows, provenanceOf(result), {
          primary: config.eodEnabled, value: config.eodEnabled ? "overwrite" : "fill", foreign: true,
        }));
        if (sessions.some((row) => row.date === session)) filled += 1;
      }
      if (config.eodEnabled) {
        const expected = await activeSymbols(services.db);
        const present = await symbolsWithDaily(services.db, session, source.id);
        const covered = expected.filter((symbol) => present.has(symbol)).length;
        const complete = expected.length > 0 && covered === expected.length;
        const final = wibToday(now) > session || jakartaClock(now).minutes >= 21 * 60 || complete;
        const status = complete ? "COMPLETE" : final ? "STALE" : "PARTIAL";
        await recordEodSession(services.db, session, { status, expected: expected.length, present: covered, final });
        if (status === "STALE") services.log.warn("eod_session_stale", { session, expected: expected.length, present: covered, source: source.id });
      }
      services.log.info("foreign_flow_stopped", { session, reason: stop, used, budget: config.dailyBudget, remaining, reserve: config.reserve, filled, queued: queue.length });
      return stop === "yield" ? { status: "YIELDED" } : undefined;
    },
  };
}
