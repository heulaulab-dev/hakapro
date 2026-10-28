// IDX company directory mapped to the engine's existing securities contract.
import { z } from "zod";
import type { IdxFetchResult, IdxJsonParams, IdxJsonTransport } from "./idx-primary";

export const IDX_COMPANY_PROFILES_PATH = "/ListedCompany/GetCompanyProfiles" as const;
export const IDX_COMPANY_DETAIL_PATH = "/ListedCompany/GetCompanyProfilesDetail" as const;
const companyRow = z.object({
  KodeEmiten: z.string().min(1), NamaEmiten: z.string().nullable().optional(), Sektor: z.string().nullable().optional(),
  SubSektor: z.string().nullable().optional(), Industri: z.string().nullable().optional(), SubIndustri: z.string().nullable().optional(),
  PapanPencatatan: z.string().nullable().optional(), TanggalPencatatan: z.string().nullable().optional(),
}).loose();
const companyEnvelope = z.object({ recordsTotal: z.number().optional(), recordsFiltered: z.number().optional(), data: z.array(companyRow) }).loose();
export type IdxCompanyUpsert = { symbol: string; name: string | null; sector: string | null; subsector: string | null; industry: string | null; board: string | null; listingDate: string | null };

export function idxCompanyProfilesParams(): IdxJsonParams { return { start: 0, length: 9999 }; }

export function parseIdxCompanyProfiles(body: unknown) {
  const parsed = companyEnvelope.parse(body);
  const seen = new Set<string>();
  const rows: IdxCompanyUpsert[] = [];
  for (const raw of parsed.data) {
    const symbol = raw.KodeEmiten.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,8}$/.test(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    const date = raw.TanggalPencatatan?.slice(0, 10) ?? null;
    rows.push({ symbol, name: raw.NamaEmiten?.trim() || null, sector: raw.Sektor?.trim() || null, subsector: raw.SubSektor?.trim() || null,
      industry: [raw.Industri?.trim(), raw.SubIndustri?.trim()].filter(Boolean).join(" / ") || null, board: raw.PapanPencatatan?.trim() || null,
      listingDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null });
  }
  const complete = typeof parsed.recordsTotal === "number" && typeof parsed.recordsFiltered === "number"
    ? parsed.recordsTotal === parsed.recordsFiltered && rows.length === parsed.recordsTotal
    : rows.length > 0 && rows.length === (parsed.recordsFiltered ?? parsed.recordsTotal);
  return { rows, complete };
}

export function fetchIdxCompanyProfiles(transport: IdxJsonTransport, signal?: AbortSignal): Promise<IdxFetchResult> {
  return transport.fetchJson(IDX_COMPANY_PROFILES_PATH, idxCompanyProfilesParams(), signal);
}

const detailRecord = z.array(z.record(z.string(), z.unknown())).default([]);
const detailsEnvelope = z.object({
  Profiles: z.array(z.record(z.string(), z.unknown())).min(1),
  Direktur: detailRecord, Komisaris: detailRecord, KomiteAudit: detailRecord,
  PemegangSaham: detailRecord, AnakPerusahaan: detailRecord,
}).loose();
const safeProfileKeys = ["KodeEmiten", "NamaEmiten", "Website", "KegiatanUsahaUtama", "Sektor", "SubSektor", "Industri", "SubIndustri", "PapanPencatatan", "TanggalPencatatan"] as const;
const stripPrivateKeys = (record: Record<string, unknown>) => Object.fromEntries(Object.entries(record).filter(([key]) => !/^(npwp|npkp|id|dataid)$/i.test(key)));
export type IdxIssuerProfile = {
  symbol: string; language: string; profile: Record<string, unknown>; directors: Record<string, unknown>[];
  commissioners: Record<string, unknown>[]; auditCommittee: Record<string, unknown>[];
  shareholders: Record<string, unknown>[]; subsidiaries: Record<string, unknown>[];
};

export function idxCompanyDetailParams(symbol: string, language = "id-id"): IdxJsonParams {
  const code = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,8}$/.test(code) || !["id-id", "en-us"].includes(language)) throw new Error("invalid IDX company detail request");
  return { KodeEmiten: code, language };
}

export function parseIdxCompanyDetail(body: unknown, symbol: string, language = "id-id"): IdxIssuerProfile {
  const code = symbol.trim().toUpperCase();
  const parsed = detailsEnvelope.parse(body);
  const profileRaw = parsed.Profiles[0];
  if (String(profileRaw.KodeEmiten ?? "").trim().toUpperCase() !== code) throw new Error("IDX company profile symbol mismatch");
  return {
    symbol: code, language,
    profile: Object.fromEntries(safeProfileKeys.filter((key) => profileRaw[key] !== undefined).map((key) => [key, profileRaw[key]])),
    directors: parsed.Direktur.map(stripPrivateKeys), commissioners: parsed.Komisaris.map(stripPrivateKeys),
    auditCommittee: parsed.KomiteAudit.map(stripPrivateKeys), shareholders: parsed.PemegangSaham.map(stripPrivateKeys),
    subsidiaries: parsed.AnakPerusahaan.map(stripPrivateKeys),
  };
}

export function fetchIdxCompanyDetail(transport: IdxJsonTransport, symbol: string, language = "id-id", signal?: AbortSignal): Promise<IdxFetchResult> {
  return transport.fetchJson(IDX_COMPANY_DETAIL_PATH, idxCompanyDetailParams(symbol, language), signal);
}
