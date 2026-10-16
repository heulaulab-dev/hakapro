// Pasardana public JSON (DATA-ENGINE.md §5.1/§5.2): universe with sector/industry, capitalisation and free float, plus
// the previous session's adjusted OHLC, volume, value and frequency. Third-party aggregator; unofficial (§8.6).
import { z } from "zod";
import { symbolSchema } from "@/server/schemas/inputs";

export const PASARDANA_ORIGIN = "https://pasardana.id";
export const PASARDANA_HOST = "pasardana.id";
/** Rows per page; ~1 KB each. `pageBegin` is a 1-based page number (checked 2026-10-16). */
export const PASARDANA_PAGE_SIZE = 200;
export const PASARDANA_MAX_PAGES = 10;

export function getAllUrl(page: number, pageLength = PASARDANA_PAGE_SIZE): string {
  const params = new URLSearchParams({ pageBegin: String(page), pageLength: String(pageLength), sortField: "Code", sortOrder: "ASC" });
  return `${PASARDANA_ORIGIN}/api/StockSearchResult/GetAll?${params}`;
}

const num = z.number().nullable().optional().transform((value) => value ?? null);
const text = z.string().nullable().optional().transform((value) => value?.trim() || null);
const rowSchema = z.object({
  Code: z.string(), Name: text, SectorName: text, SubSectorName: text, NewSectorName: text, NewSubSectorName: text, NewIndustryName: text,
  Last: num, PrevClosingPrice: num, AdjustedOpenPrice: num, AdjustedHighPrice: num, AdjustedLowPrice: num, AdjustedClosingPrice: num,
  Volume: num, Frequency: num, Value: num, Capitalization: num, FreeFloatPct: num, Per: num, Pbr: num, Roe: num,
  LastDate: z.string().nullable().optional(),
});

export type PasardanaRow = {
  symbol: string; name: string | null; sector: string | null; subsector: string | null; industry: string | null;
  /** Session the price fields belong to (`LastDate`), or null when absent. */
  date: string | null;
  open: number | null; high: number | null; low: number | null; close: number | null; previousClose: number | null;
  volume: number | null; value: number | null; frequency: number | null;
  marketCap: number | null; sharesOutstanding: number | null; freeFloatPct: number | null;
  /** Pasardana's own ratios as published: `Per`, `Pbr` (multiples) and `Roe` (a fraction: 0.24 = 24%). */
  ratios: { per: number | null; pbv: number | null; roe: number | null };
};

const int = (value: number | null) => (value === null ? null : Math.round(value));
const finite = (value: number | null) => (value !== null && Number.isFinite(value) ? value : null);

/** Parses one GetAll page. Rows with a code that is not a plain IDX symbol are skipped. */
export function parseGetAll(textBody: string): { rows: PasardanaRow[]; received: number; skipped: number } {
  const items = z.array(z.unknown()).parse(JSON.parse(textBody));
  const rows: PasardanaRow[] = [];
  let skipped = 0;
  for (const item of items) {
    const parsed = rowSchema.safeParse(item);
    const symbol = parsed.success ? symbolSchema.safeParse(parsed.data.Code) : null;
    if (!parsed.success || !symbol?.success || symbol.data !== parsed.data.Code) { skipped += 1; continue; }
    const row = parsed.data;
    const date = row.LastDate && /^\d{4}-\d{2}-\d{2}/.test(row.LastDate) ? row.LastDate.slice(0, 10) : null;
    const close = row.AdjustedClosingPrice ?? row.Last;
    rows.push({
      symbol: symbol.data, name: row.Name,
      // IDX-IC (2021) classification first; the old JASICA sector names only as a fallback.
      sector: row.NewSectorName ?? row.SectorName, subsector: row.NewSubSectorName ?? row.SubSectorName, industry: row.NewIndustryName,
      date, open: row.AdjustedOpenPrice, high: row.AdjustedHighPrice, low: row.AdjustedLowPrice, close, previousClose: row.PrevClosingPrice,
      volume: int(row.Volume), value: int(row.Value), frequency: int(row.Frequency),
      marketCap: int(row.Capitalization),
      sharesOutstanding: row.Capitalization !== null && row.Last ? Math.round(row.Capitalization / row.Last) : null,
      freeFloatPct: row.FreeFloatPct,
      ratios: { per: finite(row.Per), pbv: finite(row.Pbr), roe: finite(row.Roe) },
    });
  }
  return { rows, received: items.length, skipped };
}
