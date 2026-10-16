// Bank Indonesia statistics pages (DATA-ENGINE.md §5.8): BI-Rate and JISDOR from the HTML tables on bi.go.id. Only
// the rows on the first page are read (the most recent 10); older rows need an ASP.NET __VIEWSTATE postback, which
// the engine does not do. Official public statistics; BPS is deferred until the owner registers a key (§8.7).
import { decodeEntities, stripHtml } from "./rss";

export const BI_ORIGIN = "https://www.bi.go.id";
export const BI_HOST = "www.bi.go.id";
export const BI_RATE_URL = `${BI_ORIGIN}/id/statistik/indikator/bi-rate.aspx`;
export const JISDOR_URL = `${BI_ORIGIN}/id/statistik/informasi-kurs/jisdor/default.aspx`;

export const MACRO_SERIES = {
  BI_RATE: { id: "BI_RATE", name: "BI-Rate", unit: "percent" },
  JISDOR: { id: "JISDOR", name: "JISDOR USD/IDR", unit: "IDR per USD" },
} as const;
export type MacroSeriesId = keyof typeof MACRO_SERIES;

export type MacroRow = { series: MacroSeriesId; date: string; value: number; link: string | null };

export class BiTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BiTableError";
  }
}

const MONTHS: Record<string, number> = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6, juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, agu: 8, ags: 8, agt: 8, sep: 9, okt: 10, nov: 11, des: 12,
};

/** `15 Oktober 2026` (Indonesian month names, full or short) → `2026-10-15`; null when not a real date. */
export function parseIndonesianDate(text: string): string | null {
  const match = text.trim().match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/i);
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  if (!month) return null;
  const [day, year] = [Number(match[1]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** `Rp17.948,00` (Indonesian grouping: `.` thousands, `,` decimals) → 17948. */
export function parseRupiah(text: string): number | null {
  const cleaned = text.replace(/^\s*Rp\.?\s*/i, "").trim();
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(cleaned)) return null;
  return Number(cleaned.replace(/\./g, "").replace(",", "."));
}

/** `5.75 %` or `5,75%` → 5.75 (percent units). */
export function parsePercent(text: string): number | null {
  const match = text.trim().match(/^(\d{1,2}(?:[.,]\d{1,4})?)\s*%$/);
  return match ? Number(match[1].replace(",", ".")) : null;
}

type Table = { headers: string[]; rows: Array<{ cells: string[]; hrefs: string[] }> };

/** Every `<table>` with a `<thead>`: header texts and, per body row, cell texts (th and td) and link targets. */
function tables(html: string): Table[] {
  const out: Table[] = [];
  // Commented-out columns (the BI-Rate page keeps an old `BI-7 Day` header in a comment) must not shift the indexes.
  const clean = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const table of clean.matchAll(/<table[\s>][\s\S]*?<\/table\s*>/gi)) {
    const head = table[0].match(/<thead[\s>][\s\S]*?<\/thead\s*>/i);
    if (!head) continue;
    const headers = [...head[0].matchAll(/<th[\s>][\s\S]*?<\/th\s*>/gi)].map((cell) => stripHtml(cell[0]));
    const body = table[0].slice((head.index ?? 0) + head[0].length);
    const rows = [...body.matchAll(/<tr[\s>][\s\S]*?<\/tr\s*>/gi)].map((row) => ({
      cells: [...row[0].matchAll(/<t[hd][\s>][\s\S]*?<\/t[hd]\s*>/gi)].map((cell) => stripHtml(cell[0])),
      hrefs: [...row[0].matchAll(/<a\s[^>]*href\s*=\s*"([^"]*)"/gi)].map((link) => decodeEntities(link[1])),
    })).filter((row) => row.cells.length > 0);
    out.push({ headers, rows });
  }
  return out;
}

function findTable(html: string, required: string[]): Table {
  const table = tables(html).find((candidate) => required.every((name) => candidate.headers.some((header) => header.toLowerCase() === name.toLowerCase())));
  if (!table) throw new BiTableError(`BI table with columns ${required.join(", ")} not found`);
  return table;
}

const absolute = (href: string | undefined) => {
  if (!href || /^javascript:/i.test(href)) return null;
  try {
    const url = new URL(href, BI_ORIGIN);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
};

/** BI-Rate decisions (`No, Tanggal, BI-Rate, Pranala Siaran Pers`), newest first, with the press-release link. */
export function parseBiRate(html: string): MacroRow[] {
  const table = findTable(html, ["Tanggal", "BI-Rate"]);
  const dateAt = table.headers.findIndex((header) => header.toLowerCase() === "tanggal");
  const valueAt = table.headers.findIndex((header) => header.toLowerCase() === "bi-rate");
  const rows = table.rows.map((row) => {
    const date = parseIndonesianDate(row.cells[dateAt] ?? "");
    const value = parsePercent(row.cells[valueAt] ?? "");
    if (!date || value === null) throw new BiTableError(`Unexpected BI-Rate row: ${row.cells.join(" | ").slice(0, 120)}`);
    if (value < 0 || value > 25) throw new BiTableError(`BI-Rate out of range: ${value}`);
    return { series: "BI_RATE" as const, date, value, link: absolute(row.hrefs[0]) };
  });
  if (!rows.length) throw new BiTableError("BI-Rate table has no rows");
  return rows;
}

/** JISDOR reference rates (`Tanggal, Kurs`), newest first. */
export function parseJisdor(html: string): MacroRow[] {
  const table = findTable(html, ["Tanggal", "Kurs"]);
  const dateAt = table.headers.findIndex((header) => header.toLowerCase() === "tanggal");
  const valueAt = table.headers.findIndex((header) => header.toLowerCase() === "kurs");
  const rows = table.rows.map((row) => {
    const date = parseIndonesianDate(row.cells[dateAt] ?? "");
    const value = parseRupiah(row.cells[valueAt] ?? "");
    if (!date || value === null) throw new BiTableError(`Unexpected JISDOR row: ${row.cells.join(" | ").slice(0, 120)}`);
    if (value < 1000 || value > 100_000) throw new BiTableError(`JISDOR out of range: ${value}`);
    return { series: "JISDOR" as const, date, value, link: null };
  });
  if (!rows.length) throw new BiTableError("JISDOR table has no rows");
  return rows;
}
