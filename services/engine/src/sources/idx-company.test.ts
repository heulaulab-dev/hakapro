import { describe, expect, it } from "vitest";
import fixture from "./fixtures/idx-company-profile.2026-08-07.json";
import detailFixture from "./fixtures/idx-company-detail.2026-08-07.json";
import { idxCompanyDetailParams, idxCompanyProfilesParams, parseIdxCompanyDetail, parseIdxCompanyProfiles } from "./idx-company";

describe("IDX company directory", () => {
  it("maps the profile fields into securities without treating a sample page as complete", () => {
    const parsed = parseIdxCompanyProfiles(fixture);
    expect(idxCompanyProfilesParams()).toEqual({ start: 0, length: 9999 });
    expect(parsed).toEqual({ complete: false, rows: [{ symbol: "AADI", name: "PT Adaro Andalan Indonesia Tbk", sector: "Energi", subsector: "Minyak, Gas & Batu Bara", industry: "Batu Bara / Produksi Batu Bara", board: "Utama", listingDate: "2024-12-05" }] });
  });
  it("marks a directory complete only when reported record count matches valid unique symbols", () => {
    const response = { recordsTotal: 1, recordsFiltered: 1, data: [{ KodeEmiten: " aadi ", NamaEmiten: "AADI" }] };
    expect(parseIdxCompanyProfiles(response).complete).toBe(true);
    expect(parseIdxCompanyProfiles({ ...response, recordsTotal: 2 }).complete).toBe(false);
  });
  it("validates issuer detail and strips tax and internal identifier fields", () => {
    expect(idxCompanyDetailParams(" aadi ")).toEqual({ KodeEmiten: "AADI", language: "id-id" });
    const profile = parseIdxCompanyDetail(detailFixture, "AADI");
    expect(profile).toMatchObject({ symbol: "AADI", profile: { Website: "www.adaroindonesia.com" }, directors: [{ Nama: "Julius Aslan" }], shareholders: [{ Persentase: 41.0965 }] });
    expect(profile.profile).not.toHaveProperty("NPWP");
    expect(() => parseIdxCompanyDetail(detailFixture, "BBCA")).toThrow("symbol mismatch");
    expect(() => idxCompanyDetailParams("../AADI")).toThrow();
  });
});
