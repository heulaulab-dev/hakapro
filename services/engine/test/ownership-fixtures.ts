// SYNTHETIC ≥1% shareholder lists for tests. Every ticker (TEST1…TEST4), issuer and holder below is invented; no real
// dataset was read, downloaded or copied. The PDF imitates the column layout documented in CONNECTION-NETWORK.md §1.3
// (DATE, SHARE_CODE, ISSUER_NAME, INVESTOR_NAME, INVESTOR_TYPE, LOCAL_FOREIGN, nationality, domicile, scripless/scrip
// split, TOTAL_HOLDING_SHARES, PERCENTAGE) with Indonesian number formats, wrapped names, page footers and a header
// repeated on page 2. `bun services/engine/test/fixtures/ownership/generate.ts` rewrites the committed files.
import { zipSync, strToU8 } from "fflate";
import { buildPdf, type PdfPage, type PdfText } from "./pdf-writer";

export type SyntheticLine = {
  ticker: string; issuer: string; holder: string; type: string; lf: string; nationality: string; domicile: string;
  scripless: string; scrip: string; total: string; percent: string;
};

const line = (ticker: string, issuer: string, holder: string, type: string, lf: string, scripless: string, scrip: string, total: string, percent: string, origin = "INDONESIA"): SyntheticLine =>
  ({ ticker, issuer, holder, type, lf, nationality: origin, domicile: origin, scripless, scrip, total, percent });

const TEST1 = "PT CONTOH DUMMY TBK";
const TEST2 = "PT FIKTIF SEJAHTERA TBK";
const TEST3 = "PT UJI COBA TBK";
const TEST4 = "PT BARU FIKTIF TBK";
const CUSTODIAN = "DUMMY CUSTODIAN BANK SINGAPORE BRANCH S/A CONTOH CLIENT ACCOUNT";

/** Position 27-Feb-2026. */
export const FEB_2026: { date: string; lines: SyntheticLine[] } = {
  date: "27-Feb-2026",
  lines: [
    line("TEST1", TEST1, "PT CONTOH INDUK FIKTIF", "CP", "L", "600.000.000", "0", "600.000.000", "60,00"),
    line("TEST1", TEST1, CUSTODIAN, "CP", "A", "64.000.000", "0", "64.000.000", "6,40", "SINGAPORE"),
    line("TEST1", TEST1, "NEGARA REPUBLIK INDONESIA", "OT", "L", "31.000.000", "0", "31.000.000", "3,10"),
    line("TEST1", TEST1, "BUDI CONTOH", "ID", "L", "19.500.000", "500.000", "20.000.000", "2,00"),
    line("TEST1", TEST1, "REKSA DANA CONTOH SAHAM", "MF", "L", "15.000.000", "0", "15.000.000", "1,50"),
    line("TEST2", TEST2, "PT FIKTIF HOLDCO", "CP", "L", "450.000.000", "0", "450.000.000", "45,00"),
    line("TEST2", TEST2, "SITI CONTOH", "ID", "L", "12.000.000", "0", "12.000.000", "1,20"),
    line("TEST2", TEST2, "DANA PENSIUN CONTOH", "PF", "L", "30.000.000", "0", "30.000.000", "3,00"),
    line("TEST3", TEST3, "PT UJI INDUK", "CP", "L", "700.000.000", "0", "700.000.000", "70,00"),
  ],
};

/** Position 31-Mar-2026: increases, a decrease, a new holder, one dropping below 1 %, a duplicate and a malformed line. */
export const MAR_2026: { date: string; lines: SyntheticLine[] } = {
  date: "31-Mar-2026",
  lines: [
    line("TEST1", TEST1, "PT CONTOH INDUK FIKTIF", "CP", "L", "610.000.000", "0", "610.000.000", "61,00"),
    line("TEST1", TEST1, CUSTODIAN, "CP", "A", "64.000.000", "0", "64.000.000", "6,40", "SINGAPORE"),
    line("TEST1", TEST1, "NEGARA REPUBLIK INDONESIA", "OT", "L", "31.000.000", "0", "31.000.000", "3,10"),
    line("TEST1", TEST1, "BUDI CONTOH", "ID", "L", "19.500.000", "500.000", "20.000.000", "2,00"),
    line("TEST1", TEST1, "ANDI CONTOH", "ID", "L", "11.000.000", "0", "11.000.000", "1,10"),
    line("TEST2", TEST2, "PT FIKTIF HOLDCO", "CP", "L", "440.000.000", "0", "440.000.000", "44,00"),
    line("TEST2", TEST2, "SITI CONTOH", "ID", "L", "12.000.000", "0", "12.000.000", "1,20"),
    line("TEST2", TEST2, "SITI CONTOH", "ID", "L", "12.000.000", "0", "12.000.000", "1,20"),
    line("TEST2", TEST2, "PT RUSAK CONTOH", "CP", "L", "12.34.56", "0", "12.34.56", "1,05"),
    line("TEST2", TEST2, "DANA PENSIUN CONTOH", "PF", "L", "30.000.000", "0", "30.000.000", "3,00"),
    line("TEST4", TEST4, "PT BARU INDUK", "CP", "L", "800.000.000", "0", "800.000.000", "80,00"),
  ],
};

type Column = { key: keyof SyntheticLine | "date"; header: [string] | [string, string]; x: number; align: "left" | "right"; wrapAt?: number };

// Positions on a 1000 × 600 pt page. Text columns are left-aligned at x; number columns right-aligned at x.
const COLUMNS = (twoLineHeader: boolean): Column[] => [
  { key: "date", header: ["DATE"], x: 18, align: "left" },
  { key: "ticker", header: ["SHARE_CODE"], x: 72, align: "left" },
  { key: "issuer", header: ["ISSUER_NAME"], x: 128, align: "left", wrapAt: 30 },
  { key: "holder", header: ["INVESTOR_NAME"], x: 262, align: "left", wrapAt: 38 },
  { key: "type", header: twoLineHeader ? ["INVESTOR", "TYPE"] : ["INVESTOR_TYPE"], x: 432, align: "left" },
  { key: "lf", header: twoLineHeader ? ["LOCAL", "FOREIGN"] : ["LOCAL_FOREIGN"], x: 500, align: "left" },
  { key: "nationality", header: ["NATIONALITY"], x: 568, align: "left" },
  { key: "domicile", header: ["DOMICILE"], x: 640, align: "left" },
  { key: "scripless", header: twoLineHeader ? ["HOLDINGS", "SCRIPLESS"] : ["HOLDINGS_SCRIPLESS"], x: 776, align: "right" },
  { key: "scrip", header: twoLineHeader ? ["HOLDINGS", "SCRIP"] : ["HOLDINGS_SCRIP"], x: 840, align: "right" },
  { key: "total", header: twoLineHeader ? ["TOTAL HOLDING", "SHARES"] : ["TOTAL_HOLDING_SHARES"], x: 930, align: "right" },
  { key: "percent", header: ["PERCENTAGE"], x: 984, align: "right" },
];

/** Splits text into chunks of at most `width` characters on spaces. */
function wrap(text: string, width?: number): string[] {
  if (!width || text.length <= width) return [text];
  const out: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    if (current && `${current} ${word}`.length > width) { out.push(current); current = word; }
    else current = current ? `${current} ${word}` : word;
  }
  if (current) out.push(current);
  return out;
}

export type PdfFixtureOptions = { rowsPerPage?: number; twoLineHeader?: boolean; headerOnEveryPage?: boolean };

/** The ≥1% list as a PDF in the documented layout (top-aligned rows, wrapped names continue below). */
export function syntheticOwnershipPdf(month: { date: string; lines: SyntheticLine[] }, options: PdfFixtureOptions = {}): Uint8Array {
  const rowsPerPage = options.rowsPerPage ?? 6;
  const columns = COLUMNS(options.twoLineHeader ?? false);
  const chunks: SyntheticLine[][] = [];
  for (let index = 0; index < month.lines.length; index += rowsPerPage) chunks.push(month.lines.slice(index, index + rowsPerPage));
  const pages: PdfPage[] = chunks.map((chunk, pageIndex) => {
    const items: PdfText[] = [];
    let y = 560;
    const withHeader = pageIndex === 0 || (options.headerOnEveryPage ?? true);
    if (pageIndex === 0) {
      items.push({ x: 18, y, text: "PEMEGANG SAHAM DI ATAS 1% (KSEI) - SYNTHETIC TEST FIXTURE, NOT REAL DATA", size: 9, bold: true });
      y -= 13;
      items.push({ x: 18, y, text: `Posisi: ${month.date}`, size: 8 });
      y -= 18;
    }
    if (withHeader) {
      for (const column of columns) {
        column.header.forEach((label, row) => items.push({ x: column.x, y: y - row * 7, text: label, size: 5.5, bold: true, align: column.align }));
      }
      y -= columns.some((column) => column.header.length > 1) ? 18 : 11;
    }
    for (const entry of chunk) {
      let height = 1;
      for (const column of columns) {
        const value = column.key === "date" ? month.date : entry[column.key];
        const parts = wrap(value, column.wrapAt);
        height = Math.max(height, parts.length);
        parts.forEach((part, index) => items.push({ x: column.x, y: y - index * 7.5, text: part, size: 6.5, align: column.align }));
      }
      y -= 7.5 * height + 4;
    }
    items.push({ x: 470, y: 24, text: `Halaman ${pageIndex + 1} dari ${chunks.length}`, size: 6.5 });
    return items;
  });
  return buildPdf(pages, { width: 1000, height: 600, title: `SYNTHETIC ownership fixture ${month.date}` });
}

const CSV_HEADER = ["DATE", "SHARE_CODE", "ISSUER_NAME", "INVESTOR_NAME", "TOTAL_HOLDING_SHARES", "PERCENTAGE", "LOCAL_FOREIGN", "INVESTOR_TYPE"];
const csvField = (value: string, delimiter: string) => (value.includes(delimiter) || value.includes('"') ? `"${value.replace(/"/g, '""')}"` : value);

/** The ≥1% list as a CSV in the extracted column order of §1.3 (semicolon-separated by default, as Indonesian Excel saves it). */
export function syntheticOwnershipCsv(month: { date: string; lines: SyntheticLine[] }, delimiter = ";"): string {
  const rows = month.lines.map((entry) => [month.date, entry.ticker, entry.issuer, entry.holder, entry.total, entry.percent, entry.lf, entry.type]);
  return [CSV_HEADER, ...rows].map((row) => row.map((value) => csvField(value, delimiter)).join(delimiter)).join("\r\n") + "\r\n";
}

const xmlEscape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const columnName = (index: number): string => (index >= 26 ? columnName(Math.floor(index / 26) - 1) : "") + String.fromCharCode(65 + (index % 26));

/**
 * The ≥1% list as a minimal XLSX: a title row, then the header, then rows with shares as numbers, percentages as
 * percent-formatted fractions (style 1) and the date as a date-formatted serial (style 2), like a real Excel export.
 */
export function syntheticOwnershipXlsx(month: { date: string; isoDate: string; lines: SyntheticLine[] }): Uint8Array {
  const shared: string[] = [];
  const stringCell = (ref: string, text: string) => {
    let index = shared.indexOf(text);
    if (index < 0) index = shared.push(text) - 1;
    return `<c r="${ref}" t="s"><v>${index}</v></c>`;
  };
  const serial = (Date.parse(`${month.isoDate}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
  const toNumber = (id: string) => id.replace(/\./g, "").replace(",", ".");
  const rows: string[] = [`<row r="1">${stringCell("A1", `Pemegang Saham di atas 1% - SYNTHETIC - Posisi ${month.date}`)}</row>`];
  rows.push(`<row r="3">${CSV_HEADER.map((label, index) => stringCell(`${columnName(index)}3`, label)).join("")}</row>`);
  month.lines.forEach((entry, index) => {
    const r = index + 4;
    const percent = /^[\d.,]+$/.test(entry.percent) ? `<c r="F${r}" s="1"><v>${Number(toNumber(entry.percent)) / 100}</v></c>` : stringCell(`F${r}`, entry.percent);
    const total = /^\d{1,3}(\.\d{3})*$/.test(entry.total) ? `<c r="E${r}"><v>${toNumber(entry.total)}</v></c>` : stringCell(`E${r}`, entry.total);
    rows.push(`<row r="${r}"><c r="A${r}" s="2"><v>${serial}</v></c>${stringCell(`B${r}`, entry.ticker)}${stringCell(`C${r}`, entry.issuer)}${stringCell(`D${r}`, entry.holder)}${total}${percent}${stringCell(`G${r}`, entry.lf)}${stringCell(`H${r}`, entry.type)}</row>`);
  });
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\-mmm\\-yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="10"/><xf numFmtId="164"/></cellXfs></styleSheet>`),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join("")}</sheetData></worksheet>`),
    "xl/sharedStrings.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((text) => `<si><t>${xmlEscape(text)}</t></si>`).join("")}</sst>`),
  };
  return zipSync(files, { mtime: new Date("2026-01-01T00:00:00Z") });
}
