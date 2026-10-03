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
} as const;
