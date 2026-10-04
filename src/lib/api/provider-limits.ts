/**
 * Maximum page sizes the arjum provider accepts (it answers 422 above these). Verified against the
 * live API on 2026-10-03. Routes validate against these, and callers never request more.
 */
export const ARJUM_LIMITS = {
  insiders: 15,
  marketCapPerPage: 50,
  doneDetailsPerPage: 100,
  historyRows: 500,
  /** History also has a minimum: fewer than 20 rows is rejected. */
  historyMinRows: 20,
  accumulationTop: 5,
  /** broker-summary `broker_limit` / `level_limit` (documented 1..200). 200 covers every IDX broker, so `all_data` is never needed. */
  brokerSummaryRows: 200,
  /** market-cap `codes`: more than 50 is rejected, not truncated. */
  marketCapCodes: 50,
  /** financial-statements `limit` (documented max 40). */
  financialPeriods: 40,
} as const;

/** Analysis texts per comparison request. Each symbol is one provider request, run one after another. */
export const ANALYSIS_BATCH_MAX = 5;
