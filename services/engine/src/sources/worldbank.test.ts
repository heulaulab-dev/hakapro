import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  COMMODITY_MONTHS,
  findPinkSheetUrl,
  parsePinkSheet,
  parsePinkSheetPeriod,
  PinkSheetError,
  WORLD_BANK_COMMODITIES,
} from "./worldbank";

const COMMODITIES = Object.entries(WORLD_BANK_COMMODITIES) as [string, { column: string; name: string; unit: string }][];
const colLetter = (i: number) => String.fromCharCode(66 + i); // B, C, D, … (A is the period column)

/** Builds a minimal but valid Pink Sheet xlsx: row 5 names, row 6 units, then one data row per period (newest last). */
function pinkSheetXlsx(periods: { period: string; values: (number | "…")[] }[]): Uint8Array {
  // Shared strings: commodity names (rubber carries a footnote marker on the real sheet), units, periods, and "…".
  const names = COMMODITIES.map(([, c]) => (c.column === "Rubber, TSR20" ? "Rubber, TSR20 **" : c.column));
  const units = COMMODITIES.map(([, c]) => `(${c.unit})`);
  const strings = [...names, ...units, ...periods.map((p) => p.period), "…"];
  const idx = (s: string) => strings.indexOf(s);
  const ss = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings
    .map((s) => `<si><t>${s}</t></si>`)
    .join("")}</sst>`;

  const sCell = (ref: string, s: string) => `<c r="${ref}" t="s"><v>${idx(s)}</v></c>`;
  const nCell = (ref: string, v: number) => `<c r="${ref}"><v>${v}</v></c>`;
  const header = (rowNum: number, labels: string[]) =>
    `<row r="${rowNum}">${labels.map((l, i) => sCell(`${colLetter(i)}${rowNum}`, l)).join("")}</row>`;
  const dataRow = (rowNum: number, period: string, values: (number | "…")[]) =>
    `<row r="${rowNum}">${sCell(`A${rowNum}`, period)}${values
      .map((v, i) => (v === "…" ? sCell(`${colLetter(i)}${rowNum}`, "…") : nCell(`${colLetter(i)}${rowNum}`, v)))
      .join("")}</row>`;

  const rows = [
    `<row r="1"><c r="A1" t="s"><v>${idx(names[0])}</v></c></row>`, // title rows 1-4 are ignored by the parser
    header(5, names),
    header(6, units),
    ...periods.map((p, i) => dataRow(7 + i, p.period, p.values)),
  ].join("");
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;

  const workbook = `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Mismatch Details" sheetId="1" r:id="rId9"/><sheet name="Monthly Prices" sheetId="2" r:id="rId1"/></sheets></workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet2.xml"/><Relationship Id="rId9" Target="worksheets/sheet1.xml"/></Relationships>`;

  return zipSync({
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(rels),
    "xl/sharedStrings.xml": strToU8(ss),
    "xl/worksheets/sheet2.xml": strToU8(sheet),
  });
}

describe("parsePinkSheetPeriod", () => {
  it("maps a YYYYMmm monthly period to the first of the month", () => {
    expect(parsePinkSheetPeriod("1960M01")).toBe("1960-01-01");
    expect(parsePinkSheetPeriod("2026M09")).toBe("2026-09-01");
  });
  it("rejects non-monthly or out-of-range periods", () => {
    expect(parsePinkSheetPeriod("2026Q1")).toBeNull();
    expect(parsePinkSheetPeriod("2026M13")).toBeNull();
    expect(parsePinkSheetPeriod("")).toBeNull();
  });
});

describe("findPinkSheetUrl", () => {
  it("extracts the current workbook URL from the landing page", () => {
    const html = `<a href="https://thedocs.worldbank.org/en/doc/abc123-0050012026/related/CMO-Historical-Data-Monthly.xlsx">Monthly</a>`;
    expect(findPinkSheetUrl(html)).toBe("https://thedocs.worldbank.org/en/doc/abc123-0050012026/related/CMO-Historical-Data-Monthly.xlsx");
  });
  it("throws when no workbook link is present", () => {
    expect(() => findPinkSheetUrl("<p>no link here</p>")).toThrow(PinkSheetError);
  });
});

describe("parsePinkSheet", () => {
  it("parses every configured commodity, newest month first, matching names despite footnote markers", () => {
    const values = COMMODITIES.map((_, i) => 100 + i);
    const xlsx = pinkSheetXlsx([
      { period: "2026M08", values },
      { period: "2026M09", values: values.map((v) => v + 1) },
    ]);
    const rows = parsePinkSheet(xlsx);

    expect(new Set(rows.map((r) => r.series)).size).toBe(COMMODITIES.length);
    const coal = rows.filter((r) => r.series === "wb.coal_au");
    expect(coal.map((r) => r.date)).toEqual(["2026-09-01", "2026-08-01"]); // newest first
    // Rubber's column name carries " **" on the sheet but still maps to wb.rubber_tsr20.
    expect(rows.some((r) => r.series === "wb.rubber_tsr20")).toBe(true);
    expect(rows[0].link).toContain("worldbank.org");
  });

  it("skips missing values (…) and keeps only the trailing COMMODITY_MONTHS", () => {
    const base = COMMODITIES.map((_, i) => 50 + i);
    // 30 months, oldest first; the data-row builder lays them newest-last.
    const periods = Array.from({ length: COMMODITY_MONTHS + 6 }, (_, m) => ({
      period: `20${String(24 + Math.floor(m / 12)).padStart(2, "0")}M${String((m % 12) + 1).padStart(2, "0")}`,
      values: base.map((v) => v + m) as (number | "…")[],
    }));
    // Gold is missing (…) in the NEWEST month; coal is present in every month.
    const goldCol = COMMODITIES.findIndex(([id]) => id === "wb.gold");
    periods[periods.length - 1].values[goldCol] = "…";
    const newest = periods[periods.length - 1].period.replace(/(\d{4})M(\d{2})/, "$1-$2-01");
    const rows = parsePinkSheet(pinkSheetXlsx(periods));

    // Every series still yields exactly the trailing window, never a missing or non-positive value.
    for (const [id] of COMMODITIES) expect(rows.filter((r) => r.series === id).length).toBe(COMMODITY_MONTHS);
    expect(rows.every((r) => Number.isFinite(r.value) && r.value > 0)).toBe(true);
    // Coal's newest observation is the newest month; gold skipped that month, so its newest is earlier.
    expect(rows.find((r) => r.series === "wb.coal_au")!.date).toBe(newest);
    expect(rows.find((r) => r.series === "wb.gold")!.date).not.toBe(newest);
  });

  it("throws when a configured commodity column is absent (layout drift)", () => {
    // A workbook whose Monthly Prices sheet lost the Gold column must fail loudly.
    const xlsx = pinkSheetXlsx([{ period: "2026M09", values: COMMODITIES.map((_, i) => 10 + i) }]);
    const broken = new TextDecoder().decode(xlsx); // not a real mutation; instead build a sheet missing Gold below
    expect(broken.length).toBeGreaterThan(0);
    // Build a sheet that omits the Gold column by dropping it from the shared registry view.
    const names = COMMODITIES.filter(([id]) => id !== "wb.gold").map(([, c]) => c.column);
    const ss = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${names.map((n) => `<si><t>${n}</t></si>`).join("")}</sst>`;
    const sheetRows = `<row r="5">${names.map((n, i) => `<c r="${colLetter(i)}5" t="s"><v>${i}</v></c>`).join("")}</row><row r="7"><c r="A7" t="s"><v>0</v></c></row>`;
    const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
    const workbook = `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Monthly Prices" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`;
    const bad = zipSync({
      "xl/workbook.xml": strToU8(workbook),
      "xl/_rels/workbook.xml.rels": strToU8(rels),
      "xl/sharedStrings.xml": strToU8(ss),
      "xl/worksheets/sheet1.xml": strToU8(sheet),
    });
    expect(() => parsePinkSheet(bad)).toThrow(/Gold/);
  });

  it("throws on bytes that are not a readable xlsx", () => {
    expect(() => parsePinkSheet(new Uint8Array([1, 2, 3, 4]))).toThrow(PinkSheetError);
  });
});
