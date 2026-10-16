// Synthetic fixtures only: tickers TEST1/TEST2 and every holder name below are invented. No real dataset is used.
import { describe, expect, test } from "vitest";
import { compareOwnershipSnapshots, type OwnershipComparison } from "./changes";
import { ownershipHolderKey, type OwnershipHolderKind, type OwnershipSnapshot, type OwnershipSnapshotRow } from "./snapshot";

const JAN = "2026-01-30";
const FEB = "2026-02-27";
const MAR = "2026-03-31";

function row(date: string, holderName: string, shares: string | null, percent: string | null, extra: Partial<OwnershipSnapshotRow> = {}): OwnershipSnapshotRow {
  const holderKind: OwnershipHolderKind = extra.holderKind ?? "organisation";
  return {
    ticker: "TEST1",
    holderKey: ownershipHolderKey(holderName, holderKind),
    holderName,
    holderKind,
    shares,
    percent,
    snapshotDate: date,
    source: { dataset: "synthetic-1pct", reference: `fixture ${date} / ${holderName}`, retrievedAt: "2026-10-16T00:00:00+07:00" },
    ...extra,
  };
}

function snapshot(date: string, rows: OwnershipSnapshotRow[], extra: Partial<OwnershipSnapshot> = {}): OwnershipSnapshot {
  return { ticker: "TEST1", snapshotDate: date, thresholdPercent: "1", issuedShares: null, rows, ...extra };
}

function ok(result: OwnershipComparison) {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result;
}

const byName = (result: ReturnType<typeof ok>, name: string) => result.changes.find((change) => change.holderName === name)!;

describe("compareOwnershipSnapshots: statuses", () => {
  const jan = snapshot(JAN, [
    row(JAN, "PT CONTOH DUMMY TBK", "600000000", "60.00"),
    row(JAN, "PT FIKTIF HOLDCO", "50000000", "5.00"),
    row(JAN, "BUDI CONTOH", "20000000", "2.00", { holderKind: "person" }),
    row(JAN, "REKSA DANA CONTOH SAHAM", "15000000", "1.50"),
  ]);
  const feb = snapshot(FEB, [
    row(FEB, "PT CONTOH DUMMY TBK", "610000000", "61.00"),
    row(FEB, "PT FIKTIF HOLDCO", "45000000", "4.50"),
    row(FEB, "BUDI CONTOH", "20000000", "2.00", { holderKind: "person" }),
    row(FEB, "SITI CONTOH", "12000000", "1.20", { holderKind: "person" }),
  ]);
  const result = ok(compareOwnershipSnapshots(jan, feb));

  test("increase, decrease and unchanged carry exact share and pp deltas", () => {
    expect(byName(result, "PT CONTOH DUMMY TBK")).toMatchObject({ kind: "INCREASE", sharesBefore: "600000000", sharesAfter: "610000000", shareDelta: "10000000", percentBefore: "60.000000", percentAfter: "61.000000", ppDelta: "1.000000", flags: [] });
    expect(byName(result, "PT FIKTIF HOLDCO")).toMatchObject({ kind: "DECREASE", shareDelta: "-5000000", ppDelta: "-0.500000" });
    expect(byName(result, "BUDI CONTOH")).toMatchObject({ kind: "UNCHANGED", shareDelta: "0", ppDelta: "0.000000", flags: [] });
  });

  test("a holder new to a ≥1% list is NEW with an unknown prior holding, not a jump from zero", () => {
    expect(byName(result, "SITI CONTOH")).toMatchObject({
      kind: "NEW", sharesBefore: null, percentBefore: null, shareDelta: null, ppDelta: null, sharesAfter: "12000000", percentAfter: "1.200000", flags: ["PRIOR_HOLDING_UNKNOWN"],
    });
  });

  test("a holder missing from a later ≥1% list is BELOW_THRESHOLD, never EXIT", () => {
    const change = byName(result, "REKSA DANA CONTOH SAHAM");
    expect(change).toMatchObject({ kind: "BELOW_THRESHOLD", sharesBefore: "15000000", sharesAfter: null, shareDelta: null, percentAfter: null, ppDelta: null });
    expect(result.changes.some((c) => c.kind === "EXIT")).toBe(false);
  });

  test("source references are preserved verbatim on both sides", () => {
    const change = byName(result, "PT CONTOH DUMMY TBK");
    expect(change.fromSnapshot).toEqual({ snapshotDate: JAN, present: true, rows: [jan.rows[0]] });
    expect(change.toSnapshot).toEqual({ snapshotDate: FEB, present: true, rows: [feb.rows[0]] });
    expect(byName(result, "SITI CONTOH").fromSnapshot).toEqual({ snapshotDate: JAN, present: false, rows: [] });
    expect(result.from.sources).toHaveLength(4);
    expect(result.from.sources[0]).toEqual(jan.rows[0].source);
    expect(result.to).toMatchObject({ ticker: "TEST1", snapshotDate: FEB, thresholdPercent: "1.000000", issuedShares: null });
  });

  test("counts, ordering and adjacency", () => {
    expect(result.counts).toEqual({ NEW: 1, INCREASE: 1, DECREASE: 1, EXIT: 0, UNCHANGED: 1, BELOW_THRESHOLD: 1, AMBIGUOUS: 0 });
    expect(result.changes.map((c) => c.holderKey)).toEqual([...result.changes.map((c) => c.holderKey)].sort());
    expect(result).toMatchObject({ adjacent: true, monthsApart: 1, issuedShares: null });
  });
});

describe("compareOwnershipSnapshots: EXIT needs a stated zero", () => {
  test("absence from a complete register (threshold 0) is EXIT; presence after absence is NEW from zero", () => {
    const jan = snapshot(JAN, [row(JAN, "PT CONTOH DUMMY TBK", "100", "10")], { thresholdPercent: "0" });
    const feb = snapshot(FEB, [row(FEB, "PT FIKTIF HOLDCO", "50", "5")], { thresholdPercent: "0" });
    const result = ok(compareOwnershipSnapshots(jan, feb));
    expect(byName(result, "PT CONTOH DUMMY TBK")).toMatchObject({ kind: "EXIT", sharesAfter: "0", percentAfter: "0.000000", shareDelta: "-100", ppDelta: "-10.000000", flags: [] });
    expect(byName(result, "PT FIKTIF HOLDCO")).toMatchObject({ kind: "NEW", sharesBefore: "0", shareDelta: "50", ppDelta: "5.000000", flags: [] });
  });

  test("an explicit zero-share row is EXIT even in a threshold list", () => {
    const result = ok(compareOwnershipSnapshots(
      snapshot(JAN, [row(JAN, "PT CONTOH DUMMY TBK", "100", "10")]),
      snapshot(FEB, [row(FEB, "PT CONTOH DUMMY TBK", "0", "0")]),
    ));
    expect(result.changes[0]).toMatchObject({ kind: "EXIT", shareDelta: "-100" });
  });

  test("each side's absence is read with that snapshot's own threshold", () => {
    // Complete register in January, threshold list in February: the leaver is still only BELOW_THRESHOLD.
    const result = ok(compareOwnershipSnapshots(
      snapshot(JAN, [row(JAN, "PT CONTOH DUMMY TBK", "100", "10")], { thresholdPercent: "0" }),
      snapshot(FEB, [row(FEB, "PT FIKTIF HOLDCO", "50", "5")]),
    ));
    expect(byName(result, "PT CONTOH DUMMY TBK").kind).toBe("BELOW_THRESHOLD");
    expect(byName(result, "PT FIKTIF HOLDCO")).toMatchObject({ kind: "NEW", sharesBefore: "0", flags: [] });
  });
});

describe("compareOwnershipSnapshots: corporate actions", () => {
  test("percentage moves without a share change: UNCHANGED, flagged", () => {
    const result = ok(compareOwnershipSnapshots(
      snapshot(JAN, [row(JAN, "PT CONTOH DUMMY TBK", "500", "50")]),
      snapshot(FEB, [row(FEB, "PT CONTOH DUMMY TBK", "500", "41.67")]),
    ));
    expect(result.changes[0]).toMatchObject({ kind: "UNCHANGED", shareDelta: "0", ppDelta: "-8.330000", flags: ["PERCENT_CHANGED_SHARES_UNCHANGED"] });
  });

  test("a stated issued-share change is reported and flags every continuing holder (split is not buying)", () => {
    const result = ok(compareOwnershipSnapshots(
      snapshot(JAN, [row(JAN, "PT CONTOH DUMMY TBK", "500", "50"), row(JAN, "BUDI CONTOH", "20", "2", { holderKind: "person" })], { issuedShares: "1000" }),
      snapshot(FEB, [row(FEB, "PT CONTOH DUMMY TBK", "2500", "50"), row(FEB, "SITI CONTOH", "300", "6", { holderKind: "person" })], { issuedShares: "5000" }),
    ));
    expect(result.issuedShares).toEqual({ before: "1000", after: "5000", delta: "4000" });
    expect(byName(result, "PT CONTOH DUMMY TBK")).toMatchObject({ kind: "INCREASE", shareDelta: "2000", ppDelta: "0.000000", flags: ["ISSUED_SHARES_CHANGED"] });
    expect(byName(result, "SITI CONTOH").flags).toEqual(["PRIOR_HOLDING_UNKNOWN"]);
    expect(byName(result, "BUDI CONTOH").flags).toEqual([]);
  });

  test("shares up while percentage down is flagged as diverging", () => {
    const result = ok(compareOwnershipSnapshots(
      snapshot(JAN, [row(JAN, "PT CONTOH DUMMY TBK", "500", "50")]),
      snapshot(FEB, [row(FEB, "PT CONTOH DUMMY TBK", "600", "40")]),
    ));
    expect(result.changes[0]).toMatchObject({ kind: "INCREASE", flags: ["SHARES_AND_PERCENT_DIVERGE"] });
  });
});

describe("compareOwnershipSnapshots: duplicates and missing values", () => {
  test("identical duplicate rows collapse, keeping every row reference", () => {
    const dup = row(JAN, "PT CONTOH DUMMY TBK", "100", "10.00", { source: { dataset: "synthetic-1pct", reference: "page 2 row 9", retrievedAt: "2026-10-16T00:00:00+07:00" } });
    const result = ok(compareOwnershipSnapshots(
      snapshot(JAN, [row(JAN, "PT CONTOH DUMMY TBK", "100", "10"), dup]),
      snapshot(FEB, [row(FEB, "PT CONTOH DUMMY TBK", "150", "15")]),
    ));
    expect(result.changes[0]).toMatchObject({ kind: "INCREASE", shareDelta: "50", flags: ["DUPLICATE_ROWS_COLLAPSED"] });
    expect(result.changes[0].fromSnapshot.rows).toHaveLength(2);
  });

  test("conflicting rows for one key are AMBIGUOUS: nothing is picked or summed", () => {
    const result = ok(compareOwnershipSnapshots(
      snapshot(JAN, [row(JAN, "HENDRA CONTOH", "100", "10", { holderKind: "person" })]),
      snapshot(FEB, [row(FEB, "HENDRA CONTOH", "100", "10", { holderKind: "person" }), row(FEB, "HENDRA CONTOH", "30", "3", { holderKind: "person" })]),
    ));
    expect(result.changes[0]).toMatchObject({ kind: "AMBIGUOUS", sharesBefore: null, sharesAfter: null, shareDelta: null, ppDelta: null, flags: ["CONFLICTING_DUPLICATE_ROWS"] });
    expect(result.changes[0].toSnapshot.rows).toHaveLength(2);
  });

  test("without shares on one side, the status is decided on percentage and flagged", () => {
    const result = ok(compareOwnershipSnapshots(
      snapshot(JAN, [row(JAN, "PT CONTOH DUMMY TBK", null, "10")]),
      snapshot(FEB, [row(FEB, "PT CONTOH DUMMY TBK", "120", "12")]),
    ));
    expect(result.changes[0]).toMatchObject({ kind: "INCREASE", shareDelta: null, ppDelta: "2.000000", flags: ["COMPARED_BY_PERCENT"] });
  });

  test("shares on one side and percent on the other cannot be compared", () => {
    const result = ok(compareOwnershipSnapshots(
      snapshot(JAN, [row(JAN, "PT CONTOH DUMMY TBK", "100", null)]),
      snapshot(FEB, [row(FEB, "PT CONTOH DUMMY TBK", null, "12")]),
    ));
    expect(result.changes[0]).toMatchObject({ kind: "AMBIGUOUS", flags: ["NO_COMPARABLE_VALUES"] });
  });
});

describe("compareOwnershipSnapshots: arithmetic and identity", () => {
  test("share counts beyond Number.MAX_SAFE_INTEGER stay exact", () => {
    const result = ok(compareOwnershipSnapshots(
      snapshot(JAN, [row(JAN, "PT CONTOH DUMMY TBK", "123456789012345678901", "50")]),
      snapshot(FEB, [row(FEB, "PT CONTOH DUMMY TBK", "123456789012345678902", "50")]),
    ));
    expect(result.changes[0]).toMatchObject({ kind: "INCREASE", shareDelta: "1" });
  });

  test("percentage points are fixed-precision, not floating point", () => {
    const result = ok(compareOwnershipSnapshots(
      snapshot(JAN, [row(JAN, "PT CONTOH DUMMY TBK", "110", "1.1")]),
      snapshot(FEB, [row(FEB, "PT CONTOH DUMMY TBK", "125", "1.25")]),
    ));
    expect(1.25 - 1.1).not.toBe(0.15);
    expect(result.changes[0].ppDelta).toBe("0.150000");
  });

  test("legal-form variants share a key and are flagged; people never merge on initials", () => {
    const result = ok(compareOwnershipSnapshots(
      snapshot(JAN, [row(JAN, "PT CONTOH DUMMY TBK", "100", "10"), row(JAN, "BUDI CONTOH", "20", "2", { holderKind: "person" })]),
      snapshot(FEB, [row(FEB, "CONTOH DUMMY, PT", "100", "10"), row(FEB, "B. CONTOH", "20", "2", { holderKind: "person" })]),
    ));
    const company = result.changes.find((change) => change.holderKey === "org:CONTOH DUMMY")!;
    expect(company).toMatchObject({ kind: "UNCHANGED", holderName: "CONTOH DUMMY, PT", flags: ["HOLDER_NAME_CHANGED"] });
    expect(result.counts).toMatchObject({ NEW: 1, BELOW_THRESHOLD: 1 });
  });

  test("a kind relabel within the organisation family keeps the key and is flagged", () => {
    const result = ok(compareOwnershipSnapshots(
      snapshot(JAN, [row(JAN, "PT DANA NEGARA FIKTIF", "100", "10", { holderKind: "organisation" })]),
      snapshot(FEB, [row(FEB, "PT DANA NEGARA FIKTIF", "100", "10", { holderKind: "government" })]),
    ));
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ kind: "UNCHANGED", holderKind: "government", flags: ["HOLDER_KIND_CHANGED"] });
  });

  test("aggregate lines are flagged as not holders", () => {
    const result = ok(compareOwnershipSnapshots(
      snapshot(JAN, [row(JAN, "MASYARAKAT", "300", "30", { holderKind: "public" })]),
      snapshot(FEB, [row(FEB, "MASYARAKAT", "320", "32", { holderKind: "public" })]),
    ));
    expect(result.changes[0]).toMatchObject({ holderKey: "public:MASYARAKAT", flags: ["AGGREGATE_ROW"] });
  });
});

describe("compareOwnershipSnapshots: refusals", () => {
  const jan = snapshot(JAN, [row(JAN, "PT CONTOH DUMMY TBK", "100", "10")]);
  const mar = snapshot(MAR, [row(MAR, "PT CONTOH DUMMY TBK", "100", "10")]);

  test("non-adjacent months are refused unless allowed, then marked", () => {
    expect(compareOwnershipSnapshots(jan, mar)).toMatchObject({ ok: false, reason: "NON_ADJACENT_MONTHS" });
    expect(compareOwnershipSnapshots(jan, mar, { allowNonAdjacent: true })).toMatchObject({ ok: true, adjacent: false, monthsApart: 2 });
  });

  test("December → January is adjacent", () => {
    const dec = snapshot("2025-12-30", [row("2025-12-30", "PT CONTOH DUMMY TBK", "100", "10")]);
    expect(compareOwnershipSnapshots(dec, jan)).toMatchObject({ ok: true, adjacent: true, monthsApart: 1 });
  });

  test("wrong order, same month and different tickers are refused", () => {
    const feb = snapshot(FEB, []);
    expect(compareOwnershipSnapshots(feb, jan)).toMatchObject({ ok: false, reason: "NOT_CHRONOLOGICAL" });
    expect(compareOwnershipSnapshots(jan, jan)).toMatchObject({ ok: false, reason: "NOT_CHRONOLOGICAL" });
    expect(compareOwnershipSnapshots(snapshot("2026-01-15", []), jan)).toMatchObject({ ok: false, reason: "SAME_MONTH" });
    expect(compareOwnershipSnapshots(jan, { ...feb, ticker: "TEST2" })).toMatchObject({ ok: false, reason: "TICKER_MISMATCH" });
  });

  test("malformed input throws at the schema boundary", () => {
    const foreign = { ...jan, rows: [{ ...jan.rows[0], ticker: "TEST2" }] };
    expect(() => compareOwnershipSnapshots(foreign, snapshot(FEB, []))).toThrow(/row ticker TEST2/);
    expect(() => compareOwnershipSnapshots(snapshot(JAN, [row(JAN, "X CONTOH", "1.5", "1")]), snapshot(FEB, []))).toThrow();
    expect(() => compareOwnershipSnapshots(snapshot(JAN, [row(JAN, "X CONTOH", "1", "100.5")]), snapshot(FEB, []))).toThrow();
    expect(() => compareOwnershipSnapshots(snapshot(JAN, [row(JAN, "X CONTOH", "1", "1.1234567")]), snapshot(FEB, []))).toThrow();
  });
});
