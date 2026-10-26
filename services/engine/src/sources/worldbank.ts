// World Bank Commodity Price Data, the "Pink Sheet" (DATA-ENGINE.md §5; research 2026-10-26-engine-data-sources §b
// row 31). The monthly workbook CMO-Historical-Data-Monthly.xlsx carries ~65 years of monthly commodity prices and
// is CC BY 4.0 (commercial use allowed with attribution — download the file, not the API, whose terms are stricter).
// Only commodities that move a real IDX sector are kept (coal, CPO, nickel, gold, …); each is matched by its column
// NAME in the sheet, not a fixed column letter, so a World Bank layout change surfaces as a loud parse failure rather
// than silently reading the wrong column. The file's download URL carries a per-release hash, so the monthly job
// discovers the current URL from the landing page (findPinkSheetUrl) before fetching the workbook.
import { unzipSync } from "fflate";
import { decodeEntities } from "./rss";

export const WORLD_BANK_LANDING_HOST = "www.worldbank.org";
export const WORLD_BANK_FILE_HOST = "thedocs.worldbank.org";
export const WORLD_BANK_LANDING_URL = "https://www.worldbank.org/en/research/commodity-markets";

/** Required attribution for World Bank CC BY 4.0 data, surfaced in the /v1/macro response meta. */
export const WORLD_BANK_ATTRIBUTION = "Source: World Bank Commodity Price Data (The Pink Sheet), CC BY 4.0";

/**
 * The commodities the engine keeps, each mapped to its exact column name on the "Monthly Prices" sheet. `name` is the
 * label the engine serves; `column` is the World Bank header to match. Kept to commodities that drive an IDX sector:
 * energy (coal, oil, gas), plantation (CPO, rubber), base and precious metals.
 */
export const WORLD_BANK_COMMODITIES = {
  "wb.crude_brent": { column: "Crude oil, Brent", name: "Crude oil (Brent)", unit: "$/bbl" },
  "wb.coal_au": { column: "Coal, Australian", name: "Coal (Australian)", unit: "$/mt" },
  "wb.gas_lng_jp": { column: "Liquefied natural gas, Japan", name: "LNG (Japan)", unit: "$/mmbtu" },
  "wb.palm_oil": { column: "Palm oil", name: "Palm oil (CPO)", unit: "$/mt" },
  "wb.rubber_tsr20": { column: "Rubber, TSR20", name: "Rubber (TSR20)", unit: "$/kg" },
  "wb.nickel": { column: "Nickel", name: "Nickel", unit: "$/mt" },
  "wb.copper": { column: "Copper", name: "Copper", unit: "$/mt" },
  "wb.tin": { column: "Tin", name: "Tin", unit: "$/mt" },
  "wb.gold": { column: "Gold", name: "Gold", unit: "$/troy oz" },
} as const;

export type CommoditySeriesId = keyof typeof WORLD_BANK_COMMODITIES;

/** How many trailing months to keep per commodity. /v1/macro serves the newest 10; a little headroom is enough. */
export const COMMODITY_MONTHS = 24;

export type CommodityRow = { series: CommoditySeriesId; date: string; value: number; link: string | null };

export class PinkSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PinkSheetError";
  }
}

/** The current workbook URL on thedocs.worldbank.org, read from the landing page (its path carries a release hash). */
export function findPinkSheetUrl(landingHtml: string): string {
  const match = landingHtml.match(/https:\/\/thedocs\.worldbank\.org\/[^"'\s)]*CMO-Historical-Data-Monthly\.xlsx/i);
  if (!match) throw new PinkSheetError("Pink Sheet XLSX link not found on the commodity-markets page");
  return decodeEntities(match[0]);
}

const decoder = new TextDecoder();
const columnLetters = (ref: string) => ref.replace(/\d+$/, "");

/** `<si>` run text, concatenating `<t>` nodes and decoding XML entities (shared-strings table of an xlsx). */
function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((si) =>
    decodeEntities([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
  );
}

/** Resolves one `<c>` cell to its string value (shared string, inline string, or raw number), or "" when empty. */
function cellText(cell: string, strings: string[]): string {
  const type = cell.match(/\bt="([^"]+)"/)?.[1];
  if (type === "inlineStr") return decodeEntities(cell.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "");
  const raw = cell.match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (raw === undefined) return "";
  if (type === "s") return strings[Number(raw)] ?? "";
  return raw;
}

/** `{ "A": "1960M01", "B": "1.6", … }` for one `<row>` body, keyed by column letter. */
function rowCells(body: string, strings: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const cell of body.matchAll(/<c\s[^>]*r="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
    out[columnLetters(cell[1])] = cellText(cell[0], strings);
  }
  return out;
}

/** `1960M01` → `1960-01-01`; null when it is not a `YYYYMmm` monthly period. */
export function parsePinkSheetPeriod(period: string): string | null {
  const match = period.trim().match(/^(\d{4})M(\d{2})$/);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${match[2]}-01`;
}

/** Finds the entry path of the named worksheet inside the unzipped workbook. */
function worksheetPath(files: Record<string, Uint8Array>, sheetName: string): string {
  const workbook = decoder.decode(files["xl/workbook.xml"]);
  const rels = decoder.decode(files["xl/_rels/workbook.xml.rels"]);
  const rid = workbook.match(new RegExp(`<sheet[^>]*name="${sheetName}"[^>]*r:id="(rId\\d+)"`))?.[1];
  if (!rid) throw new PinkSheetError(`Worksheet "${sheetName}" not found in workbook`);
  const target = rels.match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1];
  if (!target) throw new PinkSheetError(`Worksheet "${sheetName}" relationship ${rid} not found`);
  return `xl/${target.replace(/^\//, "").replace(/^\//, "")}`;
}

/**
 * Parses the "Monthly Prices" sheet of the Pink Sheet workbook into rows for the configured commodities only, keeping
 * the newest `months` observations each. Row 5 holds the commodity names, row 6 the units `($/mt)`, data rows start
 * at row 7 with the period (`1960M01`) in column A. A missing value is `…` (or blank) and is skipped. Throws when a
 * configured commodity's column name is absent — a layout change must fail loudly, not read the wrong column.
 */
export function parsePinkSheet(bytes: Uint8Array, months = COMMODITY_MONTHS): CommodityRow[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (error) {
    throw new PinkSheetError(`Not a readable xlsx: ${error instanceof Error ? error.message : "unzip failed"}`);
  }
  const sheetFile = files[worksheetPath(files, "Monthly Prices")];
  if (!sheetFile) throw new PinkSheetError('"Monthly Prices" sheet file missing from workbook');
  const strings = files["xl/sharedStrings.xml"] ? sharedStrings(decoder.decode(files["xl/sharedStrings.xml"])) : [];
  const xml = decoder.decode(sheetFile);

  const rows = new Map<number, string>();
  for (const row of xml.matchAll(/<row[^>]*\sr="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) rows.set(Number(row[1]), row[2]);

  const names = rowCells(rows.get(5) ?? "", strings);
  // Column letter for each configured commodity, by exact name match on row 5.
  const columnOf = new Map<string, CommoditySeriesId>();
  // Some names carry a trailing footnote marker on the sheet (e.g. "Rubber, TSR20 **"); ignore it when matching.
  const headerName = (col: string) => names[col].trim().replace(/\s*\*+$/, "");
  for (const [series, spec] of Object.entries(WORLD_BANK_COMMODITIES) as [CommoditySeriesId, { column: string; name: string }][]) {
    const column = Object.keys(names).find((col) => headerName(col) === spec.column);
    if (!column) throw new PinkSheetError(`Commodity column "${spec.column}" not found on the Monthly Prices sheet`);
    columnOf.set(column, series);
  }

  // Data rows, newest period first; keep only the trailing `months` per series.
  const dataRows = [...rows.keys()].filter((r) => r >= 7).sort((a, b) => b - a);
  const out: CommodityRow[] = [];
  const kept = new Map<CommoditySeriesId, number>();
  for (const r of dataRows) {
    const cells = rowCells(rows.get(r) ?? "", strings);
    const date = parsePinkSheetPeriod(cells["A"] ?? "");
    if (!date) continue;
    for (const [column, series] of columnOf) {
      if ((kept.get(series) ?? 0) >= months) continue;
      const value = Number((cells[column] ?? "").trim());
      if (!Number.isFinite(value) || value <= 0) continue; // "…" or blank → missing
      out.push({ series, date, value, link: WORLD_BANK_LANDING_URL });
      kept.set(series, (kept.get(series) ?? 0) + 1);
    }
    if (kept.size === columnOf.size && [...kept.values()].every((n) => n >= months)) break;
  }
  if (!out.length) throw new PinkSheetError("No commodity observations parsed from the Monthly Prices sheet");
  return out;
}
