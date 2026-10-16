// strategy-scan-eod (E4, HAKA-64): the HAKA-17 draft rules (BREAKOUT, BB REVERSAL behind gate G) over the whole
// active universe from daily_prices, once the session's EOD data is final. Registered only with
// ENGINE_STRATEGY_SCANS_ENABLED. Reads stored rows only: no source is called.
//   21:00 WIB on trading days (after the 20:45 final eod-daily run), again at 23:00 in case eod-daily ran long;
//   a scheduled run skips a session that already has a SUCCEEDED run, a manual run (admin) always recomputes.
//   A session whose eod_sessions status is not COMPLETE is not scanned: the run is recorded as SKIPPED with the reason.
import { eodSession } from "../db/ingest";
import { hasSucceededRun, loadScanInput, saveScanRun, saveSkippedRun } from "../db/strategy-store";
import type { JobDefinition } from "../schedule/scheduler";
import { lastCompletedSession } from "../sources/session";
import { STRATEGY_RULES, type StrategyRules } from "../strategies/rules";
import { scanUniverse } from "../strategies/scan";
import type { JobServices } from "./common";

export const STRATEGY_SCAN_JOB_ID = "strategy-scan-eod";
export const STRATEGY_SCAN_CRON = "0 21,23 * * *";

export function strategyScanJob(services: Pick<JobServices, "db" | "log" | "now">, rules: StrategyRules = STRATEGY_RULES): JobDefinition {
  return {
    id: STRATEGY_SCAN_JOB_ID,
    trigger: { kind: "cron", spec: STRATEGY_SCAN_CRON, tradingDaysOnly: true },
    async run(ctx) {
      const now = services.now();
      const session = lastCompletedSession(now);
      const meta = { rules, asOf: now, jobRunId: ctx.runId };

      if (ctx.trigger === "schedule" && (await hasSucceededRun(services.db, session, rules.rulesVersion))) {
        services.log.info("strategy_scan_already_done", { session, rulesVersion: rules.rulesVersion });
        return;
      }
      const state = await eodSession(services.db, session);
      if (state?.status !== "COMPLETE") {
        const reason = `EOD session ${session} is ${state?.status ?? "not recorded"}, not COMPLETE`;
        await saveSkippedRun(services.db, session, reason, meta);
        services.log.warn("strategy_scan_skipped", { session, status: state?.status ?? null });
        return;
      }

      const result = scanUniverse(await loadScanInput(services.db, session, rules));
      for (const bad of result.badRows) services.log.warn("strategy_bad_row", { session, symbol: bad.symbol, detail: bad.detail });
      await saveScanRun(services.db, result, meta);
      ctx.report.rows(result.candidates.length);
      services.log.info("strategy_scan_done", {
        session, rulesVersion: rules.rulesVersion, covered: result.universe.covered, eligible: result.universe.eligible,
        breakout: result.candidates.filter((candidate) => candidate.strategyId === "breakout").length,
        bbReversal: result.candidates.filter((candidate) => candidate.strategyId === "bb-reversal").length,
      });
    },
  };
}
