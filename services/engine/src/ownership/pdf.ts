// PDF reader for the ≥1% list: text extraction with positions (unpdf, the serverless pdf.js build: pure JS, no native
// dependencies, no worker), then a positional table reader driven by the header row. Layout knobs are in layout.ts.
//
// How a page becomes records:
//   1. Text items → lines (same baseline within PDF_LAYOUT.lineToleranceEm).
//   2. The header line is the first line whose cells match ≥ PDF_LAYOUT.minHeaderMatches aliases (a second header line
//      just below is merged in). Its cells give each column an x-range; the boundary between two columns is the midpoint
//      of the gap between their header labels. A page without a header reuses the previous page's columns.
//   3. Every later line: each text item goes to the column containing its centre. A line with a ticker, shares or
//      percent is a data row. A line with text only in wrapping columns (names) continues an adjacent row's cells.
//      Footers and running totals (IGNORED_LINE_PATTERNS) are skipped; anything else is reported as a warning.
import { extractTextItems } from "unpdf";
import { fieldForHeader, IGNORED_LINE_PATTERNS, PDF_LAYOUT, REQUIRED_FIELDS, TITLE_DATE_PATTERN, WRAPPING_FIELDS, type OwnershipField } from "./layout";
import { OwnershipFileError, type OwnershipFileParser, type ParseIssue, type RawRecord, type RawTable } from "./raw-table";

export type TextItem = { str: string; x: number; y: number; width: number; fontSize: number };
type Line = { y: number; fontSize: number; items: TextItem[]; number: number };
type Cell = { text: string; x0: number; x1: number };
type Column = { label: string; field: OwnershipField | null; x0: number; x1: number; from: number; to: number };

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** Groups a page's text items into lines, top to bottom, items left to right. Whitespace-only items are dropped. */
export function toLines(items: TextItem[]): Line[] {
  const sorted = items.filter((item) => item.str.trim() !== "").sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const item of sorted) {
    const line = lines.at(-1);
    const tolerance = Math.max(item.fontSize, 1) * PDF_LAYOUT.lineToleranceEm;
    if (line && Math.abs(line.y - item.y) <= tolerance) line.items.push(item);
    else lines.push({ y: item.y, fontSize: item.fontSize, items: [item], number: lines.length + 1 });
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.fontSize = Math.max(...line.items.map((item) => item.fontSize));
  }
  return lines;
}

/** Joins items with small gaps into cells (a header label pdf.js split into several runs). */
function toCells(line: Line): Cell[] {
  const cells: Cell[] = [];
  for (const item of line.items) {
    const last = cells.at(-1);
    if (last && item.x - last.x1 < line.fontSize * PDF_LAYOUT.cellJoinGapEm) {
      last.text = `${last.text}${item.x - last.x1 > line.fontSize * 0.15 ? " " : ""}${item.str}`;
      last.x1 = Math.max(last.x1, item.x + item.width);
    } else {
      cells.push({ text: item.str, x0: item.x, x1: item.x + item.width });
    }
  }
  return cells.map((cell) => ({ ...cell, text: collapse(cell.text) }));
}

const matchCount = (cells: Cell[]) => {
  const fields = new Set(cells.map((cell) => fieldForHeader(cell.text)).filter(Boolean));
  return { count: fields.size, required: REQUIRED_FIELDS.every((field) => fields.has(field)) };
};

/** Merges a second header line into the first: each lower label joins the upper label it overlaps, or stands alone. */
function mergeHeader(upper: Cell[], lower: Cell[]): Cell[] {
  const merged = upper.map((cell) => ({ ...cell }));
  for (const cell of lower) {
    const centre = (cell.x0 + cell.x1) / 2;
    const target = merged.find((candidate) => candidate.x0 <= cell.x1 && cell.x0 <= candidate.x1)
      ?? merged.find((candidate) => Math.abs((candidate.x0 + candidate.x1) / 2 - centre) < 6);
    if (target) {
      target.text = `${target.text} ${cell.text}`;
      target.x0 = Math.min(target.x0, cell.x0);
      target.x1 = Math.max(target.x1, cell.x1);
    } else {
      merged.push({ ...cell });
    }
  }
  return merged.sort((a, b) => a.x0 - b.x0);
}

function toColumns(cells: Cell[]): Column[] {
  const sorted = [...cells].sort((a, b) => a.x0 - b.x0);
  return sorted.map((cell, index) => ({
    label: cell.text, field: fieldForHeader(cell.text), x0: cell.x0, x1: cell.x1,
    from: index === 0 ? -Infinity : (sorted[index - 1].x1 + cell.x0) / 2,
    to: index === sorted.length - 1 ? Infinity : (cell.x1 + sorted[index + 1].x0) / 2,
  }));
}

/** Finds the header on a page: its columns and the index of the first line after it. */
function findHeader(lines: Line[]): { columns: Column[]; next: number } | null {
  for (let index = 0; index < lines.length; index += 1) {
    const cells = toCells(lines[index]);
    const single = matchCount(cells);
    const below = lines[index + 1];
    if (below && lines[index].y - below.y <= lines[index].fontSize * PDF_LAYOUT.headerMergeLineHeights) {
      const merged = mergeHeader(cells, toCells(below));
      const double = matchCount(merged);
      if (double.required && double.count >= PDF_LAYOUT.minHeaderMatches && double.count > single.count) return { columns: toColumns(merged), next: index + 2 };
    }
    if (single.required && single.count >= PDF_LAYOUT.minHeaderMatches) return { columns: toColumns(cells), next: index + 1 };
  }
  return null;
}

/** Text of each column on a line (items assigned by their centre, joined left to right). */
function lineCells(line: Line, columns: Column[]): Map<Column, string> {
  const byColumn = new Map<Column, TextItem[]>();
  for (const item of line.items) {
    const centre = item.x + item.width / 2;
    const column = columns.find((candidate) => centre >= candidate.from && centre < candidate.to)!;
    byColumn.set(column, [...(byColumn.get(column) ?? []), item]);
  }
  const out = new Map<Column, string>();
  for (const [column, items] of byColumn) {
    let text = "";
    let end = -Infinity;
    for (const item of items) {
      text += `${text && item.x - end > line.fontSize * 0.15 ? " " : ""}${item.str}`;
      end = item.x + item.width;
    }
    out.set(column, collapse(text));
  }
  return out;
}

const lineText = (line: Line) => collapse(line.items.map((item) => item.str).join(" "));

/** Reads positioned text (one array per page) into a RawTable. Exported for tests; `read` extracts it from the PDF. */
export function readPositionedPages(pages: TextItem[][]): RawTable {
  const records: RawRecord[] = [];
  const issues: ParseIssue[] = [];
  let columns: Column[] | null = null;
  let titleDate: string | null = null;
  let firstColumns: Column[] | null = null;
  const pitches: number[] = [];

  pages.forEach((items, pageIndex) => {
    const page = pageIndex + 1;
    const lines = toLines(items);
    const header = findHeader(lines);
    let start = 0;
    if (header) {
      if (titleDate === null) {
        for (const line of lines.slice(0, header.next)) titleDate ??= TITLE_DATE_PATTERN.exec(lineText(line))?.[1] ?? null;
      }
      columns = header.columns;
      firstColumns ??= header.columns;
      start = header.next;
    } else if (!columns) {
      return; // Cover pages before the table starts (e.g. a cover letter).
    }
    const active = columns!;
    let previous: { record: RawRecord; y: number } | null = null;
    let pending: Array<{ cells: Map<Column, string>; y: number; text: string }> = [];
    const pitch = () => {
      const sorted = [...pitches].sort((a, b) => a - b);
      return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    };
    const appendTo = (record: RawRecord, cells: Map<Column, string>, text: string) => {
      for (const [column, value] of cells) {
        const field = column.field!;
        record.cells[field] = PDF_LAYOUT.continuation === "next" ? collapse(`${value} ${record.cells[field] ?? ""}`) : collapse(`${record.cells[field] ?? ""} ${value}`);
      }
      record.text = PDF_LAYOUT.continuation === "next" ? `${text} ${record.text}` : `${record.text} ${text}`;
    };
    const limit = (line: Line) => PDF_LAYOUT.continuationMaxPitch * Math.max(pitch(), line.fontSize * 1.2);

    for (const line of lines.slice(start)) {
      const locator = `p${page}.l${line.number}`;
      const text = lineText(line);
      if (findHeader([line])) continue; // The header repeated inside the page.
      const cells = lineCells(line, active);
      const filled = [...cells.keys()];
      const fieldOf = (field: OwnershipField) => [...cells].find(([column]) => column.field === field)?.[1];
      const isData = Boolean(fieldOf("ticker") || fieldOf("shares") || fieldOf("percent"));
      const wrapsOnly = filled.length > 0 && filled.every((column) => column.field !== null && WRAPPING_FIELDS.includes(column.field));

      if (isData) {
        const record: RawRecord = { locator, cells: {}, text };
        for (const [column, value] of cells) {
          if (column.field) record.cells[column.field] = record.cells[column.field] ? `${record.cells[column.field]} ${value}` : value;
        }
        if (previous) pitches.push(previous.y - line.y);
        for (const wrapped of pending) {
          if (wrapped.y - line.y <= limit(line)) appendTo(record, wrapped.cells, wrapped.text);
          else issues.push({ severity: "warning", locator, message: "wrapped text too far from its row; ignored", text: wrapped.text });
        }
        pending = [];
        records.push(record);
        previous = { record, y: line.y };
        continue;
      }
      if (IGNORED_LINE_PATTERNS.some((pattern) => pattern.test(text))) continue;
      if (wrapsOnly) {
        if (PDF_LAYOUT.continuation === "next") pending.push({ cells, y: line.y, text });
        else if (previous && previous.y - line.y <= limit(line)) {
          appendTo(previous.record, cells, text);
          previous.y = line.y;
        } else issues.push({ severity: "warning", locator, message: "text in a name column without a row to belong to; ignored", text });
        continue;
      }
      issues.push({ severity: "warning", locator, message: "line is not a table row; ignored", text });
    }
    for (const wrapped of pending) issues.push({ severity: "warning", locator: `p${page}`, message: "wrapped text at the end of the page without a row; ignored", text: wrapped.text });
  });

  if (!firstColumns) {
    throw new OwnershipFileError("No table header found. Expected a row with the ≥1% list columns (e.g. SHARE_CODE, INVESTOR_NAME, TOTAL_HOLDING_SHARES, PERCENTAGE); adjust HEADER_ALIASES in services/engine/src/ownership/layout.ts if the file uses other labels.");
  }
  return {
    records, titleDate, issues, pages: pages.length,
    columns: (firstColumns as Column[]).map((column) => ({ label: column.label, field: column.field })),
  };
}

export const pdfParser: OwnershipFileParser = {
  format: "pdf",
  async read(bytes) {
    let pages: TextItem[][];
    try {
      // unpdf may detach the buffer it is given, so it gets a copy.
      const extracted = await extractTextItems(new Uint8Array(bytes));
      pages = extracted.items.map((items) => items.map((item) => ({ str: item.str, x: item.x, y: item.y, width: item.width, fontSize: item.fontSize })));
    } catch (error) {
      throw new OwnershipFileError(`The PDF could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (pages.every((items) => items.every((item) => item.str.trim() === ""))) {
      throw new OwnershipFileError("The PDF has no text layer (a scanned image?). Only text PDFs can be parsed; upload a CSV/XLSX export instead.");
    }
    return readPositionedPages(pages);
  },
};
