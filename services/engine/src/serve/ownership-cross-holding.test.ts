import { describe, expect, it } from "vitest";
import { MemoryOwnershipStore, type NewSet, type StoredRow } from "../ownership/store";
import { crossHoldingsFor } from "./ownership";

const row = (holderName: string, shares: string, percent: string, holderKind: StoredRow["holderKind"] = "organisation"): StoredRow => ({
  lineNo: 1, holderKey: `${holderKind}:${holderName}`, holderName, holderKind,
  shares, percent, investorType: null, localForeign: null, sourceReference: `upload:test#${holderName}`,
});

const set = (symbol: string, issuerName: string, month: string, rows: StoredRow[]): NewSet => ({
  uploadId: "upload-test", symbol, month, snapshotDate: `${month}-30`, issuerName, dataset: "ksei-1pct-manual-upload",
  thresholdPercent: "1.000000", issuedShares: "1000000000", sourceReference: `KSEI ${month}`, retrievedAt: new Date("2026-10-29T00:00:00Z"),
  rawRef: "upload://test", rows,
});

describe("KSEI reciprocal cross-holdings", () => {
  it("returns one canonical pair only when both directions exist in the same snapshot", async () => {
    const store = new MemoryOwnershipStore();
    await store.replaceSets([
      set("AAA", "PT ALPHA TBK", "2026-09", [row("PT BETA TBK", "12000000", "1.200000")]),
      set("BBB", "PT BETA TBK", "2026-09", [row("PT ALPHA TBK", "34000000", "3.400000")]),
    ]);

    const result = await crossHoldingsFor(store, "AAA", "2026-09");
    expect(result).toEqual([{
      ownerSymbol: "AAA", ownerName: "PT ALPHA TBK", heldSymbol: "BBB", heldName: "PT BETA TBK",
      shares: "34000000", percent: "3.400000", reciprocalShares: "12000000", reciprocalPercent: "1.200000",
      snapshotDate: "2026-09-30", sourceReference: "upload:test#PT ALPHA TBK", reciprocalSourceReference: "upload:test#PT BETA TBK",
    }]);
    expect(await crossHoldingsFor(store, "BBB", "2026-09")).toEqual(result);
  });

  it("rejects one-way, cross-month, and non-organisation matches", async () => {
    const store = new MemoryOwnershipStore();
    await store.replaceSets([
      set("AAA", "PT ALPHA TBK", "2026-09", [row("PT BETA TBK", "12000000", "1.200000"), row("BUDI INVESTOR", "10000000", "1.000000", "person")]),
      set("BBB", "PT BETA TBK", "2026-09", []),
      set("CCC", "PT GAMMA TBK", "2026-08", [row("PT ALPHA TBK", "9000000", "0.900000")]),
    ]);

    expect(await crossHoldingsFor(store, "AAA", "2026-09")).toEqual([]);
  });

  it("requires matching snapshot dates, not just the same calendar month", async () => {
    const store = new MemoryOwnershipStore();
    await store.replaceSets([
      set("AAA", "PT ALPHA TBK", "2026-09", [row("PT BETA TBK", "12000000", "1.200000")]),
      { ...set("BBB", "PT BETA TBK", "2026-09", [row("PT ALPHA TBK", "34000000", "3.400000")]), snapshotDate: "2026-09-29" },
    ]);
    expect(await crossHoldingsFor(store, "AAA", "2026-09")).toEqual([]);
  });

  it("does not guess when issuer names collide or a listed pair is duplicated", async () => {
    const store = new MemoryOwnershipStore();
    await store.replaceSets([
      set("AAA", "PT ALPHA TBK", "2026-09", [row("PT BETA TBK", "12000000", "1.200000")]),
      set("AAB", "PT ALPHA, Tbk.", "2026-09", []),
      set("BBB", "PT BETA TBK", "2026-09", [row("PT ALPHA TBK", "34000000", "3.400000")]),
    ]);
    expect(await crossHoldingsFor(store, "AAA", "2026-09")).toEqual([]);

    await store.replaceSets([
      set("AAA", "PT ALPHA TBK", "2026-09", [row("PT BETA TBK", "12000000", "1.200000")]),
      set("BBB", "PT BETA TBK", "2026-09", [row("PT ALPHA TBK", "34000000", "3.400000"), { ...row("ALPHA", "1", "0.000001"), lineNo: 2 }]),
    ]);
    expect(await crossHoldingsFor(store, "AAA", "2026-09")).toEqual([]);
  });
});
