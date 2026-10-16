// Column layout of the KSEI ≥1% shareholder list, the one place to adjust once a real file is seen.
//
// No real PDF has been read (idx.co.id and KSEI block the engine, DATA-ENGINE.md §5.9). The layout follows what
// CONNECTION-NETWORK.md §1.3 and "Data Engine inputs" document: the extracted columns
//   DATE, SHARE_CODE, ISSUER_NAME, INVESTOR_NAME, TOTAL_HOLDING_SHARES, PERCENTAGE, LOCAL_FOREIGN, INVESTOR_TYPE
// plus nationality, domicile and a scrip/scripless split in the original PDF. Headers are matched by name (English and
// Indonesian aliases), never by position, so column order, extra columns and the CSV/XLSX fallback all go through the
// same mapping. When the real PDF arrives, check in this order:
//   1. HEADER_ALIASES: add the exact header labels it prints (after upper-casing and collapsing whitespace).
//   2. PDF_LAYOUT: header row detection (minimum matched columns, two-line headers) and where wrapped cell text goes.
//   3. IGNORED_LINE_PATTERNS: page headers/footers/totals printed between table rows.
//   4. normalize.ts → holderKindFor: the investor-type codes the file uses.

export const OWNERSHIP_FIELDS = [
  "date", "ticker", "issuerName", "holderName", "investorType", "localForeign", "nationality", "domicile",
  "sharesScripless", "sharesScrip", "shares", "percent", "issuedShares", "lineNumber",
] as const;
export type OwnershipField = (typeof OWNERSHIP_FIELDS)[number];

/** Fields a table must have: who holds which stock, and at least one of shares / percent (checked separately). */
export const REQUIRED_FIELDS: OwnershipField[] = ["ticker", "holderName"];
export const VALUE_FIELDS: OwnershipField[] = ["shares", "percent"];
/** Fields whose text may wrap onto following lines in the PDF (joined with a space). */
export const WRAPPING_FIELDS: OwnershipField[] = ["issuerName", "holderName", "nationality", "domicile"];

/** Header label → field. Keys are compared after `headerKey` (upper case, `_` → space, whitespace collapsed). */
export const HEADER_ALIASES: Record<string, OwnershipField> = {
  "DATE": "date", "TANGGAL": "date", "POSITION DATE": "date", "TANGGAL POSISI": "date", "AS OF": "date",
  "SHARE CODE": "ticker", "KODE EFEK": "ticker", "KODE SAHAM": "ticker", "KODE EMITEN": "ticker", "CODE": "ticker", "KODE": "ticker",
  "TICKER": "ticker", "SYMBOL": "ticker", "STOCK CODE": "ticker",
  "ISSUER NAME": "issuerName", "NAMA EMITEN": "issuerName", "EMITEN": "issuerName", "ISSUER": "issuerName", "NAMA PERUSAHAAN": "issuerName",
  "INVESTOR NAME": "holderName", "NAMA INVESTOR": "holderName", "NAMA PEMEGANG SAHAM": "holderName", "PEMEGANG SAHAM": "holderName",
  "HOLDER NAME": "holderName", "SHAREHOLDER NAME": "holderName", "SHAREHOLDER": "holderName", "NAMA PEMEGANG REKENING": "holderName",
  "INVESTOR TYPE": "investorType", "TIPE INVESTOR": "investorType", "JENIS INVESTOR": "investorType", "TYPE": "investorType",
  "LOCAL FOREIGN": "localForeign", "LOCAL/FOREIGN": "localForeign", "L/A": "localForeign", "L/F": "localForeign", "LOKAL/ASING": "localForeign",
  "LOKAL ASING": "localForeign", "STATUS": "localForeign",
  "NATIONALITY": "nationality", "KEBANGSAAN": "nationality", "WARGA NEGARA": "nationality", "KEWARGANEGARAAN": "nationality",
  "DOMICILE": "domicile", "DOMISILI": "domicile", "NEGARA DOMISILI": "domicile",
  "HOLDINGS SCRIPLESS": "sharesScripless", "SCRIPLESS": "sharesScripless", "JUMLAH SAHAM SCRIPLESS": "sharesScripless", "TANPA WARKAT": "sharesScripless",
  "HOLDINGS SCRIP": "sharesScrip", "SCRIP": "sharesScrip", "JUMLAH SAHAM SCRIP": "sharesScrip", "WARKAT": "sharesScrip",
  "TOTAL HOLDING SHARES": "shares", "TOTAL HOLDINGS SHARES": "shares", "TOTAL SHARES": "shares", "JUMLAH SAHAM": "shares", "TOTAL": "shares",
  "TOTAL SAHAM": "shares", "TOTAL KEPEMILIKAN": "shares", "JUMLAH KEPEMILIKAN": "shares", "SHARES": "shares",
  "PERCENTAGE": "percent", "PERSENTASE": "percent", "PERSENTASE (%)": "percent", "PERCENTAGE (%)": "percent", "%": "percent", "PCT": "percent",
  "ISSUED SHARES": "issuedShares", "LISTED SHARES": "issuedShares", "JUMLAH SAHAM TERCATAT": "issuedShares", "SAHAM BEREDAR": "issuedShares",
  "NO": "lineNumber", "NO.": "lineNumber", "NOMOR": "lineNumber",
};

export const headerKey = (label: string) => label.toUpperCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();

/** Field for a header label, or null for a column the engine doesn't use. */
export function fieldForHeader(label: string): OwnershipField | null {
  return HEADER_ALIASES[headerKey(label)] ?? null;
}

export const PDF_LAYOUT = {
  /** A line is the table header when at least this many of its cells match a header alias (and the required ones). */
  minHeaderMatches: 4,
  /** Header labels may print on two lines ("TOTAL HOLDING" / "SHARES"); the next line within this many line heights is merged. */
  headerMergeLineHeights: 1.6,
  /** Text items closer than this many font sizes on one line belong to one cell (pdf.js may split runs). */
  cellJoinGapEm: 0.6,
  /** Items within this fraction of the font size vertically are one line. */
  lineToleranceEm: 0.4,
  /**
   * A line with text only in wrapping columns continues a cell of an adjacent data row: "previous" for top-aligned
   * tables (the data row prints first, the wrapped remainder below), "next" for bottom-aligned ones.
   */
  continuation: "previous" as "previous" | "next",
  /** A continuation line must be within this many typical row pitches of its row. */
  continuationMaxPitch: 1.5,
} as const;

/** Lines printed between table rows that are not data (page headers, footers, running totals). Matched on the whole line. */
export const IGNORED_LINE_PATTERNS: RegExp[] = [
  /^(halaman|page)\s+\d+(\s+(dari|of)\s+\d+)?$/i,
  /^\d+\s*\/\s*\d+$/,
  /^(sub ?total|total|jumlah)\b/i,
  /^(sumber|source)\s*:/i,
  /^(dicetak|printed)\b/i,
];

/** A title line that states the position date ("Posisi: 27-Feb-2026", "Data per 27 Februari 2026"). Group 1 is the date. */
export const TITLE_DATE_PATTERN = /\b(?:posisi|position|per tanggal|data per|as of|tanggal)\s*:?\s*(\d{1,2}[ /.-][A-Za-z0-9]+\.?[ /.-]\d{2,4}|\d{4}-\d{2}-\d{2})/i;
