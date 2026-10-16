// Synthetic fixtures only: every name below is invented.
import { describe, expect, test } from "vitest";
import { canonicalPercent, microToPercent, percentToMicro } from "./decimal";
import { ownershipHolderKey, ownershipSnapshotRowSchema } from "./snapshot";

describe("decimal helpers", () => {
  test("percentages round-trip through integer micro-percent", () => {
    expect(percentToMicro("41.1")).toBe(41_100_000);
    expect(percentToMicro("0.000001")).toBe(1);
    expect(percentToMicro("100")).toBe(100_000_000);
    expect(microToPercent(-250_000)).toBe("-0.250000");
    expect(canonicalPercent("5.0021")).toBe("5.002100");
  });

  test("Indonesian separators, signs and excess precision are rejected rather than guessed", () => {
    for (const value of ["41,10", "-1", "1.1234567", "", "1e2"]) expect(() => percentToMicro(value)).toThrow();
  });
});

describe("ownershipHolderKey", () => {
  test("organisation-like kinds share the legal-form-normalised key", () => {
    expect(ownershipHolderKey("PT Contoh Dummy Tbk", "organisation")).toBe("org:CONTOH DUMMY");
    expect(ownershipHolderKey("CONTOH DUMMY, PT.", "government")).toBe("org:CONTOH DUMMY");
    expect(ownershipHolderKey("DUMMY CUSTODIAN BANK A/C CLIENTS", "custodian_nominee")).toBe("org:DUMMY CUSTODIAN BANK A/C CLIENTS");
  });

  test("people and unknown names match only exactly (case and whitespace aside)", () => {
    expect(ownershipHolderKey("budi  contoh", "person")).toBe("name:BUDI CONTOH");
    expect(ownershipHolderKey("B. CONTOH", "person")).not.toBe(ownershipHolderKey("BUDI CONTOH", "person"));
    expect(ownershipHolderKey("BUDI CONTOH", "unknown")).toBe(ownershipHolderKey("BUDI CONTOH", "person"));
    expect(ownershipHolderKey("BUDI CONTOH", "person")).not.toBe(ownershipHolderKey("PT BUDI CONTOH", "organisation"));
  });

  test("aggregates get their own namespace", () => {
    expect(ownershipHolderKey("Masyarakat", "public")).toBe("public:MASYARAKAT");
  });
});

describe("ownershipSnapshotRowSchema", () => {
  const valid = {
    ticker: "TEST1", holderKey: "org:CONTOH DUMMY", holderName: "PT CONTOH DUMMY TBK", holderKind: "organisation",
    shares: "1000", percent: "10.5", snapshotDate: "2026-02-27",
    source: { dataset: "synthetic-1pct", reference: "fixture row 1", retrievedAt: "2026-10-16T00:00:00+07:00" },
  };

  test("accepts a well-formed row", () => {
    expect(ownershipSnapshotRowSchema.parse(valid)).toEqual(valid);
  });

  test("requires a full source reference and a position date", () => {
    expect(() => ownershipSnapshotRowSchema.parse({ ...valid, source: { ...valid.source, reference: " " } })).toThrow();
    expect(() => ownershipSnapshotRowSchema.parse({ ...valid, source: { ...valid.source, retrievedAt: "yesterday" } })).toThrow();
    expect(() => ownershipSnapshotRowSchema.parse({ ...valid, snapshotDate: "27-Feb-2026" })).toThrow();
    expect(() => ownershipSnapshotRowSchema.parse({ ...valid, holderKind: "broker" })).toThrow();
    expect(() => ownershipSnapshotRowSchema.parse({ ...valid, shares: "3.200.142.830" })).toThrow();
  });
});
