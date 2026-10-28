import { describe, expect, it } from "vitest";
import snapshotFixture from "./fixtures/idx-bei-company-snapshot.2026-08-26.json";
import { idxBeiCompanySnapshotSchema, idxBeiProfiles, IDX_BEI_PROFILE_LANGUAGE } from "./idx-bei-companies";

const known = new Set(["BBCA", "TLKM", "EMAS", "GOTO"]);
const snapshot = idxBeiCompanySnapshotSchema.parse(snapshotFixture);

describe("IDX-BEI company snapshot → issuer profiles", () => {
  it("reads the snapshot capture time as WIB", () => {
    expect(snapshot.last_updated.toISOString()).toBe("2026-08-26T10:31:48.000Z");
  });

  it("maps the recorded companies into the native profile shape", () => {
    const parsed = idxBeiProfiles(snapshot, known);
    expect(parsed.rows.map((row) => row.symbol)).toEqual(["BBCA", "TLKM", "EMAS"]);
    const bbca = parsed.rows[0];
    expect(bbca.language).toBe(IDX_BEI_PROFILE_LANGUAGE);
    expect(bbca.profile).toEqual({ NamaEmiten: "Contoh Bank Nusantara Tbk.", Sektor: "Financials", SubSektor: "Banks", Industri: "Banks", SubIndustri: "Banks" });
    expect(bbca.directors).toEqual([{ Nama: "Director One", Jabatan: "PRESIDEN DIREKTUR" }, { Nama: "Director Two", Jabatan: "WAKIL PRESIDEN DIREKTUR" }]);
    expect(bbca.commissioners).toEqual([{ Nama: "Commissioner One", Jabatan: "PRESIDEN KOMISARIS" }]);
    expect(bbca.shareholders[0]).toEqual({ Nama: "PT Contoh Induk Investama", Persentase: 55.5 });
    expect(bbca.subsidiaries[0]).toEqual({ Nama: "PT Contoh Asuransi Jiwa", Persentase: 90, BidangUsaha: "Asuransi Jiwa" });
  });

  it("never carries snapshot prices, ratios or the source's generated verdicts", () => {
    const serialized = JSON.stringify(idxBeiProfiles(snapshot, known).rows);
    for (const forbidden of ["price", "daily_change", "ai_thesis", "dca_verdict", "compounder_score", "valuation_badge", "ACCUMULATE", "1234", "roe", "per"]) {
      expect(serialized, forbidden).not.toContain(`"${forbidden}"`);
    }
    expect(serialized).not.toContain("ACCUMULATE");
    expect(serialized).not.toContain("1234");
  });

  it("drops bad nested records but keeps the company", () => {
    const tlkm = idxBeiProfiles(snapshot, known).rows.find((row) => row.symbol === "TLKM")!;
    // Empty name and an unknown role are dropped; a percentage above 100 is invalid.
    expect(tlkm.directors).toEqual([{ Nama: "Director Three", Jabatan: "DIREKTUR" }]);
    expect(tlkm.commissioners).toEqual([{ Nama: "Commissioner Two", Jabatan: "KOMISARIS" }]);
    expect(tlkm.shareholders).toEqual([{ Nama: "PT Contoh Pengelola Aset", Persentase: 52.25 }]);
  });

  it("treats N/A classifications and a code-as-name as missing, not as values", () => {
    const emas = idxBeiProfiles(snapshot, known).rows.find((row) => row.symbol === "EMAS")!;
    expect(emas.profile).toEqual({});
    expect(emas.shareholders).toEqual([{ Nama: "PT Contoh Tambang Induk", Persentase: 63.5 }]);
  });

  it("skips codes outside HakaPro's securities directory and invalid codes, and counts them", () => {
    const parsed = idxBeiProfiles(snapshot, known);
    // GOTOM is a valid code shape but not listed here; ZZZZ is unknown.
    expect(parsed.skipped).toEqual({ invalid: 0, unknownSymbol: 2, duplicate: 0 });
    const bad = idxBeiCompanySnapshotSchema.parse({ last_updated: "2026-08-26 17:31:48", companies: [{ code: "bb-ca", name: "x" }, { code: "BBCA", name: "Bank" }, { code: "BBCA", name: "Bank dup" }] });
    expect(idxBeiProfiles(bad, known).skipped).toEqual({ invalid: 1, unknownSymbol: 0, duplicate: 1 });
  });

  it("rejects a snapshot without a usable capture time or companies", () => {
    expect(idxBeiCompanySnapshotSchema.safeParse({ last_updated: null, companies: [{}] }).success).toBe(false);
    expect(idxBeiCompanySnapshotSchema.safeParse({ last_updated: "yesterday", companies: [{}] }).success).toBe(false);
    expect(idxBeiCompanySnapshotSchema.safeParse({ last_updated: "2026-08-26 17:31:48", companies: [] }).success).toBe(false);
  });
});
