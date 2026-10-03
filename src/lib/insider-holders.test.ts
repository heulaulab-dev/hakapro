import { describe, expect, test } from "vitest";
import type { InsiderRow } from "@/lib/api/market";
import { groupInsidersByHolder, holderKind, organizationKey } from "./insider-holders";

const row = (person: string, date: string, currentPercent: number | null, extra: Partial<InsiderRow> = {}): InsiderRow => ({
  person, date, action: "BUY", nationality: "local", roles: [], broker: null,
  previousShares: null, currentShares: currentPercent === null ? null : currentPercent * 1_000_000, changeShares: null,
  previousPercent: null, currentPercent, changePercent: null, priceIdr: null, ...extra,
});

describe("holderKind / organizationKey", () => {
  test("legal-form normalisation makes company spellings equal", () => {
    const keys = ["PT Danantara Asset Management (Persero)", "PT Danantara Asset Management ", "PT DANANTARA ASSET MANAGEMENT", "DANANTARA ASSET MANAGEMENT", "PERUSAHAAN PERSEROAN (PERSERO) PT DANANTARA ASSET MANAGEMENT"].map(organizationKey);
    expect(new Set(keys).size).toBe(1);
    expect(organizationKey("HUSIN INVESTAMA, PT.")).toBe(organizationKey("PT HUSIN INVESTAMA"));
  });

  test("custodian / nominee account names get their own kind", () => {
    expect(holderKind("DBS VICKERS SECS SINGAPORE (PTE) LTD A/C CLIENTS", [])).toBe("nominee");
    expect(holderKind("THE BANK OF NEW YORK MELLON", [])).toBe("nominee");
    expect(holderKind("UOB KAY HIAN PRIVATE LIMITED", [])).toBe("nominee");
  });

  test("role badges mark people; names without a legal-form hint stay unknown", () => {
    expect(holderKind("BUDI CONTOH", ["DIREKTUR"])).toBe("person");
    expect(holderKind("BUDI CONTOH", [])).toBe("unknown");
    expect(holderKind("OMUDAS INVESTMENT HOLDCO", [])).toBe("organization");
  });
});

describe("groupInsidersByHolder", () => {
  test("companies merge across legal-form variants; people only on the exact name, labelled unverified", () => {
    const groups = groupInsidersByHolder([
      row("PT CONTOH HOLDCO TBK", "2026-09-01", 50),
      row("CONTOH HOLDCO", "2026-08-01", 48),
      row("BUDI CONTOH", "2026-07-01", 5, { roles: ["DIREKTUR"] }),
      row("B. CONTOH", "2026-06-01", 4),
      row("budi  contoh", "2026-05-01", 3),
    ]);
    const company = groups.find((group) => group.kind === "organization")!;
    expect(company.names).toEqual(["PT CONTOH HOLDCO TBK", "CONTOH HOLDCO"]);
    expect(company.identityUnverified).toBe(false);
    expect(company.latest).toEqual({ date: "2026-09-01", holdings: [{ shares: 50_000_000, percent: 50 }], ambiguous: false });
    const budi = groups.find((group) => group.names.includes("BUDI CONTOH"))!;
    expect(budi.kind).toBe("person");
    expect(budi.identityUnverified).toBe(true);
    expect(budi.names).toEqual(["BUDI CONTOH", "budi  contoh"]);
    expect(budi.roles).toEqual(["director"]);
    // An initial is never matched to a full name.
    expect(groups.find((group) => group.names.includes("B. CONTOH"))!.events).toHaveLength(1);
  });

  test("contradictory same-day rows are ambiguous and every value is kept", () => {
    const [group] = groupInsidersByHolder([
      row("OMUDAS INVESTMENT HOLDCO", "2026-09-17", 61.13),
      row("OMUDAS INVESTMENT HOLDCO", "2026-09-17", 57.98),
      row("OMUDAS INVESTMENT HOLDCO", "2025-01-01", 61.13),
    ]);
    expect(group.latest.ambiguous).toBe(true);
    expect(group.latest.holdings.map((holding) => holding.percent)).toEqual([61.13, 57.98]);
    expect(group.firstDate).toBe("2025-01-01");
  });

  test("identical same-day rows are not ambiguous", () => {
    const [group] = groupInsidersByHolder([row("PT A INVESTAMA", "2026-01-02", 5), row("PT A INVESTAMA", "2026-01-02", 5)]);
    expect(group.latest.ambiguous).toBe(false);
  });

  test("truncated organisation names are flagged as possibly the same, never merged", () => {
    const groups = groupInsidersByHolder([row("OMUDAS INVESTMENT HOLDCO", "2026-09-17", 61.13), row("OMUDAS INVESTMENT HOL", "2025-09-17", 61.13)]);
    expect(groups).toHaveLength(2);
    expect(groups[0].possiblySameAs).toEqual(["OMUDAS INVESTMENT HOL"]);
    expect(groups[1].possiblySameAs).toEqual(["OMUDAS INVESTMENT HOLDCO"]);
  });

  test("controller badge maps to a role; unknown badges are kept verbatim", () => {
    const [group] = groupInsidersByHolder([row("PT A INVESTAMA", "2026-01-02", 5, { roles: ["PENGENDALI", "PEMEGANG SAHAM UTAMA"] })]);
    expect(group.roles).toEqual(["controller"]);
    expect(group.otherBadges).toEqual(["PEMEGANG SAHAM UTAMA"]);
  });

  test("a nominee is never relabelled as an organisation owner", () => {
    const [group] = groupInsidersByHolder([row("DBS VICKERS SECS SINGAPORE (PTE) LTD A/C CLIENTS", "2026-08-27", 1.2)]);
    expect(group.kind).toBe("nominee");
  });
});
