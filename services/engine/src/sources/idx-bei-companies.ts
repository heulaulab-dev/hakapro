// IDX-BEI company reference snapshot (`/data/network_alpha_data.json`) → HakaPro issuer profiles.
// Only reference fields are read: IDX-IC classification, board members, shareholders and subsidiaries as
// disclosed in the company profile when the snapshot was captured. Everything else in the file is dropped by
// `.strip()`: snapshot prices and daily change (stale market values), financial ratios and the source's own
// generated opinions (ai_thesis, dca_verdict, compounder_score, valuation badges). Those must never be shown.
import { z } from "zod";
import { symbolSchema } from "@/server/schemas/inputs";

const text = z.string().trim();
const boardMember = z.object({ name: text.min(1), role: z.enum(["Director", "Commissioner"]), title: text.nullable().optional() }).strip();
const shareholder = z.object({ name: text.min(1), percentage: z.number().min(0).max(100).nullable().optional() }).strip();
const subsidiary = z.object({ name: text.min(1), percentage: z.number().min(0).max(100).nullable().optional(), bidang_usaha: text.nullable().optional() }).strip();
/** One bad nested record drops only that record, never the company. */
const lenient = <T extends z.ZodType>(item: T) => z.array(z.unknown()).nullable().optional()
  .transform((items) => (items ?? []).flatMap((value) => { const parsed = item.safeParse(value); return parsed.success ? [parsed.data as z.infer<T>] : []; }));

const company = z.object({
  code: text, name: text.min(1),
  sector: text.nullable().optional(), sub_sector: text.nullable().optional(), industry: text.nullable().optional(), sub_industry: text.nullable().optional(),
  board_members: lenient(boardMember), shareholders: lenient(shareholder), subsidiaries: lenient(subsidiary),
}).strip();

/** `last_updated` is a naive "YYYY-MM-DD HH:MM:SS"; the service runs its pipeline on WIB, so it is read as +07:00. */
const capturedAt = z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/)
  .transform((value) => new Date(`${value.replace(" ", "T")}+07:00`))
  .refine((date) => !Number.isNaN(date.getTime()), "invalid last_updated");

export const idxBeiCompanySnapshotSchema = z.object({
  last_updated: capturedAt,
  // Validate the envelope strictly but each company leniently: a malformed company is skipped and counted.
  companies: z.array(z.unknown()).min(1),
}).strip();
export type IdxBeiCompanySnapshot = z.infer<typeof idxBeiCompanySnapshotSchema>;

/** Same record keys the native IDX company-detail profile uses, so the existing UI renders both identically. */
export type IdxBeiIssuerProfile = {
  symbol: string; language: string; profile: Record<string, unknown>;
  directors: Record<string, unknown>[]; commissioners: Record<string, unknown>[]; auditCommittee: Record<string, unknown>[];
  shareholders: Record<string, unknown>[]; subsidiaries: Record<string, unknown>[];
};

/** Profiles share the native rows' key; the import's conflict guard keeps native IDX rows authoritative. */
export const IDX_BEI_PROFILE_LANGUAGE = "id-id";

const present = (value: string | null | undefined) => (value && value !== "N/A" ? value : undefined);

export type IdxBeiProfileParse = { capturedAt: Date; rows: IdxBeiIssuerProfile[]; skipped: { invalid: number; unknownSymbol: number; duplicate: number } };

/**
 * Normalizes a validated snapshot. `knownSymbols` is the engine's securities universe: issuer profiles reference
 * it, and a code the engine does not list (warrant-like or delisted codes) is skipped rather than invented.
 */
export function idxBeiProfiles(snapshot: IdxBeiCompanySnapshot, knownSymbols: ReadonlySet<string>): IdxBeiProfileParse {
  const skipped = { invalid: 0, unknownSymbol: 0, duplicate: 0 };
  const seen = new Set<string>();
  const rows: IdxBeiIssuerProfile[] = [];
  for (const raw of snapshot.companies) {
    const parsed = company.safeParse(raw);
    const symbol = parsed.success ? symbolSchema.safeParse(parsed.data.code) : null;
    if (!parsed.success || !symbol?.success || symbol.data !== parsed.data.code) { skipped.invalid += 1; continue; }
    if (!knownSymbols.has(symbol.data)) { skipped.unknownSymbol += 1; continue; }
    if (seen.has(symbol.data)) { skipped.duplicate += 1; continue; }
    seen.add(symbol.data);
    const c = parsed.data;
    const person = (member: z.infer<typeof boardMember>) => ({ Nama: member.name, ...(member.title ? { Jabatan: member.title } : {}) });
    rows.push({
      symbol: symbol.data, language: IDX_BEI_PROFILE_LANGUAGE,
      profile: Object.fromEntries(Object.entries({
        // A name equal to the code is the snapshot's placeholder for a profile it never captured (new listings).
        NamaEmiten: c.name !== c.code ? c.name : undefined, Sektor: present(c.sector), SubSektor: present(c.sub_sector), Industri: present(c.industry), SubIndustri: present(c.sub_industry),
      }).filter(([, value]) => value !== undefined)),
      directors: c.board_members.filter((member) => member.role === "Director").map(person),
      commissioners: c.board_members.filter((member) => member.role === "Commissioner").map(person),
      auditCommittee: [],
      shareholders: c.shareholders.map((holder) => ({ Nama: holder.name, ...(holder.percentage != null ? { Persentase: holder.percentage } : {}) })),
      subsidiaries: c.subsidiaries.map((sub) => ({
        Nama: sub.name, ...(sub.percentage != null ? { Persentase: sub.percentage } : {}), ...(sub.bidang_usaha ? { BidangUsaha: sub.bidang_usaha } : {}),
      })),
    });
  }
  return { capturedAt: snapshot.last_updated, rows, skipped };
}
