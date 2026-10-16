// Synthetic fixtures only: ticker TEST1 and every holder name below are invented. No real dataset is used.
import { describe, expect, test } from "vitest";
import { FREE_FLOAT_CAVEATS, FREE_FLOAT_METHODOLOGY, classifyHolder, estimateFreeFloat, type OfficialFreeFloat } from "./free-float";
import { ownershipHolderKey, type OwnershipHolderKind, type OwnershipSnapshot, type OwnershipSnapshotRow } from "./snapshot";

const DATE = "2026-02-27";

function row(holderName: string, percent: string | null, holderKind: OwnershipHolderKind = "organisation", reference = holderName): OwnershipSnapshotRow {
  return {
    ticker: "TEST1",
    holderKey: ownershipHolderKey(holderName, holderKind),
    holderName,
    holderKind,
    shares: null,
    percent,
    snapshotDate: DATE,
    source: { dataset: "synthetic-1pct", reference, retrievedAt: "2026-10-16T00:00:00+07:00" },
  };
}

const snapshot = (rows: OwnershipSnapshotRow[]): OwnershipSnapshot => ({ ticker: "TEST1", snapshotDate: DATE, thresholdPercent: "1", issuedShares: null, rows });

describe("classifyHolder (methodology v0.1 rules, first match wins)", () => {
  const org = (percent: string) => ({ holderKind: "organisation" as const, percent });

  test("each rule in order", () => {
    expect(classifyHolder(org("2"), { controller: true }, { holderClass: "portfolio", reason: "owner review", reference: "decision #1" })).toEqual({ holderClass: "portfolio", rule: "OVERRIDE" });
    expect(classifyHolder(org("2"), { treasury: true })).toEqual({ holderClass: "strategic", rule: "TREASURY" });
    expect(classifyHolder({ holderKind: "government", percent: "1.5" })).toEqual({ holderClass: "strategic", rule: "GOVERNMENT" });
    expect(classifyHolder({ holderKind: "person", percent: "1.2" }, { boardMember: true })).toEqual({ holderClass: "strategic", rule: "CONTROLLER_OR_BOARD" });
    expect(classifyHolder(org("1.2"), { controller: true })).toEqual({ holderClass: "strategic", rule: "CONTROLLER_OR_BOARD" });
    expect(classifyHolder(org("1.2"), { affiliate: true })).toEqual({ holderClass: "strategic", rule: "AFFILIATE" });
    expect(classifyHolder({ holderKind: "custodian_nominee", percent: "1.2" })).toEqual({ holderClass: "unknown", rule: "NOMINEE_ACCOUNT" });
    expect(classifyHolder(org("5"))).toEqual({ holderClass: "strategic", rule: "AT_OR_ABOVE_5_PERCENT" });
    expect(classifyHolder(org("1.2"), { investorType: "mf" })).toEqual({ holderClass: "portfolio", rule: "FUND_INVESTOR_TYPE" });
    expect(classifyHolder(org("4.999999"))).toEqual({ holderClass: "unknown", rule: "DEFAULT_UNKNOWN" });
  });

  test("conservative defaults: a large nominee stays unknown, a large fund is strategic, an unlisted type is unknown", () => {
    expect(classifyHolder({ holderKind: "custodian_nominee", percent: "12" })).toEqual({ holderClass: "unknown", rule: "NOMINEE_ACCOUNT" });
    expect(classifyHolder(org("6"), { investorType: "MF" })).toEqual({ holderClass: "strategic", rule: "AT_OR_ABOVE_5_PERCENT" });
    expect(classifyHolder(org("2"), { investorType: "CP" })).toEqual({ holderClass: "unknown", rule: "DEFAULT_UNKNOWN" });
    expect(classifyHolder({ holderKind: "person", percent: "3" })).toEqual({ holderClass: "unknown", rule: "DEFAULT_UNKNOWN" });
  });
});

describe("estimateFreeFloat", () => {
  const rows = [
    row("PT CONTOH DUMMY TBK", "55.25"), // ≥5 % → strategic
    row("PT DANA NEGARA FIKTIF", "3.10", "government"), // strategic
    row("DUMMY CUSTODIAN BANK A/C CLIENTS", "6.40", "custodian_nominee"), // unknown
    row("REKSA DANA CONTOH SAHAM", "2.05"), // MF signal → portfolio
    row("BUDI CONTOH", "1.20", "person"), // no signal → unknown
    row("MASYARAKAT", "31.00", "public"), // aggregate: excluded
  ];
  const signals = { [ownershipHolderKey("REKSA DANA CONTOH SAHAM", "organisation")]: { investorType: "MF" } };

  test("versioned, labelled estimate with an exact low/high range", () => {
    const result = estimateFreeFloat(snapshot(rows), { signals });
    expect(result).toMatchObject({
      figureType: "ESTIMATE",
      isOfficial: false,
      methodology: { id: "hakapro-free-float", version: "0.1-draft", status: "DRAFT_AWAITING_OWNER_APPROVAL", label: "Estimated free float (HAKAPRO methodology v0.1)" },
      ticker: "TEST1",
      asOf: DATE,
      thresholdPercent: "1.000000",
      totals: { disclosed: "68.000000", strategic: "58.350000", portfolio: "2.050000", unknown: "7.600000", undisclosed: "32.000000" },
      // low = 100 − 58.35 − 7.60; high = 100 − 58.35
      estimate: { headline: "34.050000", low: "34.050000", high: "41.650000" },
      unavailableReason: null,
      official: null,
    });
    expect(result.methodology).toBe(FREE_FLOAT_METHODOLOGY);
    expect(result.caveats).toEqual(FREE_FLOAT_CAVEATS);
    expect(result.excludedAggregates.map((r) => r.holderName)).toEqual(["MASYARAKAT"]);
    expect(result.holders.map((h) => [h.holderName, h.holderClass, h.rule])).toEqual([
      ["PT CONTOH DUMMY TBK", "strategic", "AT_OR_ABOVE_5_PERCENT"],
      ["PT DANA NEGARA FIKTIF", "strategic", "GOVERNMENT"],
      ["DUMMY CUSTODIAN BANK A/C CLIENTS", "unknown", "NOMINEE_ACCOUNT"],
      ["REKSA DANA CONTOH SAHAM", "portfolio", "FUND_INVESTOR_TYPE"],
      ["BUDI CONTOH", "unknown", "DEFAULT_UNKNOWN"],
    ]);
    expect(result.holders[0].source).toEqual(rows[0].source);
    expect(result.sources).toHaveLength(rows.length);
  });

  test("an official figure travels separately and never changes the estimate", () => {
    const official: OfficialFreeFloat = {
      figureType: "OFFICIAL",
      publisher: "Synthetic Exchange",
      percent: "40.00",
      asOf: "2026-01-30",
      source: { dataset: "synthetic-official", reference: "fixture", retrievedAt: "2026-10-16T00:00:00+07:00" },
    };
    const withOfficial = estimateFreeFloat(snapshot(rows), { signals, official });
    const without = estimateFreeFloat(snapshot(rows), { signals });
    expect(withOfficial.official).toEqual(official);
    expect(withOfficial.estimate).toEqual(without.estimate);
    expect(withOfficial.figureType).toBe("ESTIMATE");
    expect(withOfficial.isOfficial).toBe(false);
  });

  test("overrides record their reason and reference", () => {
    const key = ownershipHolderKey("BUDI CONTOH", "person");
    const result = estimateFreeFloat(snapshot(rows), { signals, overrides: { [key]: { holderClass: "strategic", reason: "disclosed founder", reference: "owner decision 2026-10-16" } } });
    expect(result.holders.find((h) => h.holderKey === key)).toMatchObject({ holderClass: "strategic", rule: "OVERRIDE", override: { reason: "disclosed founder", reference: "owner decision 2026-10-16" } });
    expect(result.estimate).toEqual({ headline: "34.050000", low: "34.050000", high: "40.450000" });
  });

  test("an exact duplicate line is counted once; same values from another line are both counted", () => {
    const exact = estimateFreeFloat(snapshot([row("PT CONTOH DUMMY TBK", "60"), row("PT CONTOH DUMMY TBK", "60.0")]));
    expect(exact.duplicateRowsCollapsed).toBe(1);
    expect(exact.totals?.strategic).toBe("60.000000");
    const twoLines = estimateFreeFloat(snapshot([row("HENDRA CONTOH", "2", "person", "row 1"), row("HENDRA CONTOH", "2", "person", "row 2")]));
    expect(twoLines.duplicateRowsCollapsed).toBe(0);
    expect(twoLines.totals?.unknown).toBe("4.000000");
  });

  test("unavailable instead of wrong: no rows, a missing percentage, or more than 100 % disclosed", () => {
    expect(estimateFreeFloat(snapshot([row("MASYARAKAT", "40", "public")]))).toMatchObject({ estimate: null, totals: null, unavailableReason: "NO_DISCLOSED_ROWS" });
    expect(estimateFreeFloat(snapshot([row("PT CONTOH DUMMY TBK", null)]))).toMatchObject({ estimate: null, unavailableReason: "MISSING_PERCENT" });
    expect(estimateFreeFloat(snapshot([row("PT CONTOH DUMMY TBK", "60"), row("PT FIKTIF HOLDCO", "40.01")]))).toMatchObject({ estimate: null, unavailableReason: "DISCLOSED_EXCEEDS_100" });
  });

  test("sums are exact at six decimals", () => {
    const result = estimateFreeFloat(snapshot([row("A CONTOH", "1.1", "person"), row("B CONTOH", "2.2", "person"), row("C CONTOH", "0.000001", "person")]));
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(result.totals?.unknown).toBe("3.300001");
    expect(result.estimate).toEqual({ headline: "96.699999", low: "96.699999", high: "100.000000" });
  });
});
