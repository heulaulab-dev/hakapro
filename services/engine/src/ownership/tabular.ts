// CSV and XLSX readers: the owner's fallback when the PDF can't be parsed (or KSEI/IDX ships a spreadsheet). Both map
// columns by header label through the same HEADER_ALIASES as the PDF, so column order and extra columns don't matter.
//   CSV: comma or semicolon separated (detected from the header), RFC 4180 quotes, UTF-8 with or without BOM.
//   XLSX: the first worksheet; shared, inline and numeric cells; percent-formatted cells ×100; date-formatted serials.
import { unzipSync } from "fflate";
import { fieldForHeader, REQUIRED_FIELDS, TITLE_DATE_PATTERN, type OwnershipField } from "./layout";
import { OwnershipFileError, type OwnershipFileParser, type RawRecord, type RawTable } from "./raw-table";

/** Header detection scans this many rows (title rows may come first). */
const HEADER_SCAN_ROWS = 25;

/** Rows of cell text (1-based row numbers) → RawTable, with the header found by its labels. */
export function readRows(rows: Array<{ number: number; cells: string[] }>): RawTable {
  let headerIndex = -1;
  let fields: Array<OwnershipField | null> = [];
  for (let index = 0; index < Math.min(rows.length, HEADER_SCAN_ROWS); index += 1) {
    const candidate = rows[index].cells.map((cell) => fieldForHeader(cell));
    if (REQUIRED_FIELDS.every((field) => candidate.includes(field)) && (candidate.includes("shares") || candidate.includes("percent"))) {
      headerIndex = index;
      fields = candidate;
      break;
    }
  }
  if (headerIndex < 0) {
    throw new OwnershipFileError("No header row found in the first rows. The file needs columns for the share code, the holder name and the shares or percentage (e.g. SHARE_CODE, INVESTOR_NAME, TOTAL_HOLDING_SHARES, PERCENTAGE).");
  }
  let titleDate: string | null = null;
  for (const row of rows.slice(0, headerIndex)) titleDate ??= TITLE_DATE_PATTERN.exec(row.cells.join(" "))?.[1] ?? null;

  const records: RawRecord[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    if (row.cells.every((cell) => cell.trim() === "")) continue;
    const record: RawRecord = { locator: `r${row.number}`, cells: {}, text: row.cells.join(" | ").trim() };
    row.cells.forEach((value, column) => {
      const field = fields[column];
      if (field && value.trim() !== "" && record.cells[field] === undefined) record.cells[field] = value.trim();
    });
    records.push(record);
  }
  const header = rows[headerIndex].cells;
  return { records, titleDate, issues: [], pages: null, columns: header.map((label, index) => ({ label, field: fields[index] ?? null })) };
}

// ── CSV ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Splits CSV text into rows of fields (RFC 4180 quoting; `delimiter` is "," or ";"). */
export function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (quoted) throw new OwnershipFileError("The CSV has an unterminated quoted field");
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export const csvParser: OwnershipFileParser = {
  format: "csv",
  async read(bytes) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
    } catch {
      throw new OwnershipFileError("The CSV is not valid UTF-8 text; save it as \"CSV UTF-8\"");
    }
    const firstLines = text.split(/\r?\n/).slice(0, HEADER_SCAN_ROWS).join("\n");
    const delimiter = (firstLines.match(/;/g)?.length ?? 0) > (firstLines.match(/,/g)?.length ?? 0) ? ";" : ",";
    return readRows(splitCsv(text, delimiter).map((cells, index) => ({ number: index + 1, cells })));
  },
};

// ── XLSX ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeXml = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") return String.fromCodePoint(entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
    return ENTITIES[entity] ?? whole;
  });
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
/** Text of every <t> inside a fragment (shared/inline strings, including rich-text runs). */
const texts = (fragment: string) => [...fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join("");

function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? "A";
  return [...letters].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 50, 57]);
const BUILTIN_PERCENT_FORMATS = new Set([9, 10]);

/** Per cell-style index: whether its number format is a percentage or a date. */
function styleKinds(stylesXml: string | null): Array<"percent" | "date" | null> {
  if (!stylesXml) return [];
  const custom = new Map<number, string>();
  for (const match of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) custom.set(Number(attr(match[0], "numFmtId")), decodeXml(attr(match[0], "formatCode") ?? ""));
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  return [...xfs.matchAll(/<xf\b[^>]*>/g)].map((match) => {
    const id = Number(attr(match[0], "numFmtId") ?? 0);
    const code = (custom.get(id) ?? "").replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
    if (BUILTIN_PERCENT_FORMATS.has(id) || code.includes("%")) return "percent";
    if (BUILTIN_DATE_FORMATS.has(id) || /[dy]/i.test(code)) return "date";
    return null;
  });
}

/** Excel serial date (1900 system) → YYYY-MM-DD. */
const serialDate = (serial: number) => new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);

/** A numeric cell as text: integers exactly, percent-formatted fractions ×100 (rounded to 6 decimals), dates as ISO. */
function numericText(raw: string, kind: "percent" | "date" | null): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  if (kind === "date") return serialDate(value);
  if (kind === "percent") return String(Number((value * 100).toFixed(6)));
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) return raw; // Too large for exact digits; the share parser rejects it.
  return Number.isInteger(value) ? value.toFixed(0) : String(value);
}

export function readXlsxRows(bytes: Uint8Array): Array<{ number: number; cells: string[] }> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (file) => file.name.startsWith("xl/") && file.name.endsWith(".xml") || file.name.endsWith(".rels") });
  } catch {
    throw new OwnershipFileError("The XLSX file could not be unzipped");
  }
  const read = (name: string) => (files[name] ? new TextDecoder().decode(files[name]) : null);
  const workbook = read("xl/workbook.xml");
  if (!workbook) throw new OwnershipFileError("Not an XLSX workbook (xl/workbook.xml is missing)");
  const firstSheet = /<sheet\b[^>]*>/.exec(workbook)?.[0];
  const relId = firstSheet ? attr(firstSheet, "r:id") : null;
  const rels = read("xl/_rels/workbook.xml.rels") ?? "";
  const target = relId ? [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((tag) => attr(tag, "Id") === relId) : null;
  const targetPath = target ? attr(target, "Target")!.replace(/^\/?xl\//, "").replace(/^\//, "") : "worksheets/sheet1.xml";
  const sheet = read(`xl/${targetPath}`);
  if (!sheet) throw new OwnershipFileError("The XLSX file has no readable first worksheet");

  const shared = [...(read("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => texts(match[1]));
  const kinds = styleKinds(read("xl/styles.xml"));
  const rows: Array<{ number: number; cells: string[] }> = [];
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const number = Number(attr(rowMatch[1], "r") ?? rows.length + 1);
    const cells: string[] = [];
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2] ?? "";
      const index = columnIndex(attr(attrs, "r") ?? "");
      const type = attr(attrs, "t");
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = "";
      if (type === "s" && value !== undefined) text = shared[Number(value)] ?? "";
      else if (type === "inlineStr") text = texts(body);
      else if (type === "str" || type === "e") text = decodeXml(value ?? "");
      else if (type === "b") text = value === "1" ? "TRUE" : "FALSE";
      else if (value !== undefined) text = numericText(value, kinds[Number(attr(attrs, "s") ?? 0)] ?? null);
      while (cells.length < index) cells.push("");
      cells[index] = text;
    }
    rows.push({ number, cells });
  }
  return rows;
}

export const xlsxParser: OwnershipFileParser = {
  format: "xlsx",
  async read(bytes) {
    return readRows(readXlsxRows(bytes));
  },
};
