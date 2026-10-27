// Recorded-shape fixture for GetIndexSummary, modeled on idx-bei docs/API_VERIFICATION_SPEC.md (the DataTables
// envelope { draw, recordsTotal, recordsFiltered, data } and the verified GetStockSummary field casing). It is a
// schema fixture, not a captured live payload — no authorized live request was made. Two good rows (IHSG + a sector)
// and two rows that MUST be rejected (non-positive close; a stale trade date) exercise validation.
export const FIXTURE_DATE = "2026-01-05";

export const IDX_INDEX_SUMMARY_FIXTURE = {
  draw: 0,
  recordsTotal: 4,
  recordsFiltered: 4,
  data: [
    { No: 1, IndexCode: "IHSG", Date: "2026-01-05T00:00:00", Previous: 7000, OpenPrice: 7010, High: 7080, Low: 6990, Close: 7050, Change: 50, Volume: 10, Value: 20, Frequency: 30, NumberOfStock: 900 },
    { No: 2, IndexCode: "IDXENERGY", Date: "2026-01-05T00:00:00", Previous: 2000, OpenPrice: 2005, High: 2030, Low: 1995, Close: 2020, Change: 20, Volume: 5, Value: 8, Frequency: 12, NumberOfStock: 80 },
    // Close 0 → non-positive, rejected (never stored).
    { No: 3, IndexCode: "IDXTECHNO", Date: "2026-01-05T00:00:00", Previous: 5000, OpenPrice: 5000, High: 5000, Low: 5000, Close: 0, Change: 0, Volume: 0, Value: 0, Frequency: 0, NumberOfStock: 10 },
    // Trade date ≠ requested date → stale page, rejected.
    { No: 4, IndexCode: "LQ45", Date: "2026-01-02T00:00:00", Previous: 900, OpenPrice: 901, High: 905, Low: 899, Close: 903, Change: 3, Volume: 1, Value: 2, Frequency: 3, NumberOfStock: 45 },
  ],
};
