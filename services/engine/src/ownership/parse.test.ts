// Parser tests on SYNTHETIC files only (test/ownership-fixtures.ts: fake tickers TEST1…TEST4, invented holders).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OWNERSHIP_FIXTURES } from "../../test/fixtures/ownership/generate";
import { FEB_2026, MAR_2026, syntheticOwnershipCsv, syntheticOwnershipPdf, syntheticOwnershipXlsx } from "../../test/ownership-fixtures";
import { buildPdf } from "../../test/pdf-writer";
import { holderKindFor } from "./normalize";
import { parseOwnershipFile } from "./parse";
import { readPositionedPages } from "./pdf";
import { detectFormat, OwnershipFileError } from "./raw-table";
import { splitCsv } from "./tabular";

const committed = (name: string) => new Uint8Array(readFileSync(new URL(`../../test/fixtures/ownership/${name}`, import.meta.url)));
const ctx = (month: string, extra: Record<string, unknown> = {}) => ({ month, retrievedAt: "2026-10-16T08:00:00.000Z", referencePrefix: "upload:test", ...extra });
const encode = (text: string) => new TextEncoder().encode(text);

const rowsOf = (result: Awaited<ReturnType<typeof parseOwnershipFile>>) =>
  result.issuers.flatMap((issuer) => issuer.rows.map((row) => [issuer.ticker, row.holderName, row.holderKind, row.shares, row.percent, row.investorType, row.localForeign]));

const FEB_ROWS = [
  ["TEST1", "PT CONTOH INDUK FIKTIF", "organisation", "600000000", "60", "CP", "L"],
  ["TEST1", "DUMMY CUSTODIAN BANK SINGAPORE BRANCH S/A CONTOH CLIENT ACCOUNT", "custodian_nominee", "64000000", "6.4", "CP", "A"],
  ["TEST1", "NEGARA REPUBLIK INDONESIA", "government", "31000000", "3.1", "OT", "L"],
  ["TEST1", "BUDI CONTOH", "person", "20000000", "2", "ID", "L"],
  ["TEST1", "REKSA DANA CONTOH SAHAM", "organisation", "15000000", "1.5", "MF", "L"],
  ["TEST2", "PT FIKTIF HOLDCO", "organisation", "450000000", "45", "CP", "L"],
  ["TEST2", "SITI CONTOH", "person", "12000000", "1.2", "ID", "L"],
  ["TEST2", "DANA PENSIUN CONTOH", "organisation", "30000000", "3", "PF", "L"],
  ["TEST3", "PT UJI INDUK", "organisation", "700000000", "70", "CP", "L"],
];

describe("committed synthetic fixtures", () => {
  it("match the generator output", () => {
    for (const [name, build] of Object.entries(OWNERSHIP_FIXTURES)) expect(Buffer.from(committed(name)).equals(Buffer.from(build())), name).toBe(true);
  });
});

describe("PDF parser (synthetic ≥1% list in the documented layout)", () => {
  it("reads every row of a two-page PDF with a repeated header, a wrapped name and page footers", async () => {
    const result = await parseOwnershipFile(committed("synthetic-1pct-2026-02.pdf"), "pdf", ctx("2026-02"));
    expect(result.snapshotDate).toBe("2026-02-27");
    expect(result.pages).toBe(2);
    expect(result.issues).toEqual([]);
    expect(result.stats).toMatchObject({ records: 9, rowsAccepted: 9, rowsRejected: 0, issuers: 3 });
    expect(rowsOf(result)).toEqual(FEB_ROWS);
    expect(result.issuers.map((issuer) => [issuer.ticker, issuer.issuerName])).toEqual([["TEST1", "PT CONTOH DUMMY TBK"], ["TEST2", "PT FIKTIF SEJAHTERA TBK"], ["TEST3", "PT UJI COBA TBK"]]);
    expect(result.columns.map((column) => column.field)).toEqual([
      "date", "ticker", "issuerName", "holderName", "investorType", "localForeign", "nationality", "domicile", "sharesScripless", "sharesScrip", "shares", "percent",
    ]);
    const first = result.issuers[0].rows[0];
    expect(first).toMatchObject({
      ticker: "TEST1", holderKey: "org:CONTOH INDUK FIKTIF", snapshotDate: "2026-02-27", lineNo: 1,
      source: { dataset: "ksei-1pct-manual-upload", reference: "upload:test#p1.l4", retrievedAt: "2026-10-16T08:00:00.000Z" },
    });
    // Columns that aren't kept (nationality, domicile) never reach a row.
    expect(Object.keys(first)).not.toContain("nationality");
    // Page 2 rows carry their own page locator.
    expect(result.issuers[2].rows[0].source.reference).toBe("upload:test#p2.l4");
  });

  it("merges a two-line header, reuses page 1 columns on a page without a header, and collects row errors", async () => {
    const result = await parseOwnershipFile(committed("synthetic-1pct-2026-03.pdf"), "pdf", ctx("2026-03"));
    expect(result.snapshotDate).toBe("2026-03-31");
    expect(result.columns.map((column) => column.label)).toContain("TOTAL HOLDING SHARES");
    expect(result.stats).toMatchObject({ records: 11, rowsAccepted: 10, rowsRejected: 1, issuers: 3 });
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([
      expect.objectContaining({ locator: "p2.l3", field: "shares", message: 'unreadable share count "12.34.56"' }),
      expect.objectContaining({ locator: "p2.l3", field: "sharesScripless" }),
    ]);
    // The duplicate published line is kept twice (distinct locators), never merged or summed.
    const siti = result.issuers[1].rows.filter((row) => row.holderName === "SITI CONTOH");
    expect(siti.map((row) => row.source.reference)).toEqual(["upload:test#p2.l1", "upload:test#p2.l2"]);
    expect(result.issuers.map((issuer) => issuer.ticker)).toEqual(["TEST1", "TEST2", "TEST4"]);
  });

  it("takes the position date from the title when there is no DATE column, and snapshotDate overrides it", () => {
    const pages = [[
      { str: "Posisi: 27 Februari 2026", x: 18, y: 560, width: 80, fontSize: 8 },
      { str: "KODE EFEK", x: 18, y: 540, width: 30, fontSize: 6 },
      { str: "NAMA PEMEGANG SAHAM", x: 80, y: 540, width: 70, fontSize: 6 },
      { str: "JUMLAH SAHAM", x: 250, y: 540, width: 40, fontSize: 6 },
      { str: "PERSENTASE", x: 320, y: 540, width: 35, fontSize: 6 },
      { str: "TEST1", x: 18, y: 528, width: 20, fontSize: 6.5 },
      { str: "PT CONTOH INDUK FIKTIF", x: 80, y: 528, width: 80, fontSize: 6.5 },
      { str: "1.000", x: 270, y: 528, width: 18, fontSize: 6.5 },
      { str: "10,00", x: 335, y: 528, width: 18, fontSize: 6.5 },
    ]];
    const table = readPositionedPages(pages);
    expect(table.titleDate).toBe("27 Februari 2026");
    expect(table.records[0].cells).toEqual({ ticker: "TEST1", holderName: "PT CONTOH INDUK FIKTIF", shares: "1.000", percent: "10,00" });
  });

  it("fails clearly when no header is found or the PDF has no text", async () => {
    const noHeader = buildPdf([[{ x: 20, y: 500, text: "Surat pengantar - SYNTHETIC" }]]);
    await expect(parseOwnershipFile(noHeader, "pdf", ctx("2026-02"))).rejects.toThrow(/No table header found/);
    const blank = buildPdf([[]]);
    await expect(parseOwnershipFile(blank, "pdf", ctx("2026-02"))).rejects.toThrow(/no text layer/);
    await expect(parseOwnershipFile(encode("%PDF-1.4 truncated"), "pdf", ctx("2026-02"))).rejects.toBeInstanceOf(OwnershipFileError);
  });

  it("refuses a file whose position date is outside the upload month", async () => {
    await expect(parseOwnershipFile(committed("synthetic-1pct-2026-02.pdf"), "pdf", ctx("2026-03"))).rejects.toThrow(/2026-02-27 is not in the upload month 2026-03/);
  });

  it("attaches wrapped name text to the row above and reports stray name text", () => {
    // PDF_LAYOUT.continuation "previous": the wrapped remainder follows its row. A stray line far away is reported.
    const pages = [[
      { str: "SHARE_CODE", x: 20, y: 500, width: 30, fontSize: 6 }, { str: "INVESTOR_NAME", x: 80, y: 500, width: 40, fontSize: 6 },
      { str: "TOTAL_HOLDING_SHARES", x: 200, y: 500, width: 60, fontSize: 6 }, { str: "PERCENTAGE", x: 280, y: 500, width: 30, fontSize: 6 },
      { str: "TEST1", x: 20, y: 490, width: 18, fontSize: 6 }, { str: "DUMMY CUSTODIAN", x: 80, y: 490, width: 50, fontSize: 6 },
      { str: "5.000", x: 240, y: 490, width: 18, fontSize: 6 }, { str: "5,00", x: 295, y: 490, width: 14, fontSize: 6 },
      { str: "A/C CLIENTS", x: 80, y: 483, width: 35, fontSize: 6 },
      { str: "ORPHAN TEXT", x: 80, y: 400, width: 35, fontSize: 6 },
    ]];
    const table = readPositionedPages(pages);
    expect(table.records).toHaveLength(1);
    expect(table.records[0].cells.holderName).toBe("DUMMY CUSTODIAN A/C CLIENTS");
    expect(table.issues).toEqual([expect.objectContaining({ severity: "warning", message: expect.stringContaining("without a row") })]);
  });

  it("parses a generated variant: header on every page, one row per page", async () => {
    const pdf = syntheticOwnershipPdf(FEB_2026, { rowsPerPage: 1 });
    const result = await parseOwnershipFile(pdf, "pdf", ctx("2026-02"));
    expect(result.pages).toBe(9);
    expect(rowsOf(result)).toEqual(FEB_ROWS);
  });
});

describe("CSV and XLSX fallback", () => {
  it("parses the committed semicolon CSV with the same rows and errors as the PDF", async () => {
    const result = await parseOwnershipFile(committed("synthetic-1pct-2026-03.csv"), "csv", ctx("2026-03"));
    const pdf = await parseOwnershipFile(committed("synthetic-1pct-2026-03.pdf"), "pdf", ctx("2026-03"));
    expect(rowsOf(result)).toEqual(rowsOf(pdf));
    expect(result.issues).toEqual([expect.objectContaining({ severity: "error", locator: "r10", field: "shares" })]);
  });

  it("reads comma CSV with quotes, a BOM, title rows and extra columns in any order", async () => {
    const csv = "﻿Pemegang Saham di atas 1% - SYNTHETIC,,\r\nPosisi: 27-Feb-2026,,\r\n"
      + "PERSENTASE,Kode Efek,Nama Pemegang Saham,Alamat,Jumlah Saham\r\n"
      + '"41,10",TEST1,"PT CONTOH, FIKTIF",JL. CONTOH 1,"3.200.142.830"\r\n'
      + '"1,00",TEST1,"BUDI ""BEN"" CONTOH",JL. CONTOH 2,\r\n';
    const result = await parseOwnershipFile(encode(csv), "csv", ctx("2026-02"));
    expect(result.snapshotDate).toBe("2026-02-27");
    expect(rowsOf(result)).toEqual([
      ["TEST1", "PT CONTOH, FIKTIF", "organisation", "3200142830", "41.1", null, null],
      ["TEST1", 'BUDI "BEN" CONTOH', "unknown", null, "1", null, null],
    ]);
    // The address column is not a known field: dropped.
    expect(result.columns.find((column) => column.label === "Alamat")?.field).toBeNull();
  });

  it("collects per-row validation errors without failing the file", async () => {
    const csv = ["DATE;SHARE_CODE;INVESTOR_NAME;TOTAL_HOLDING_SHARES;PERCENTAGE;INVESTOR_TYPE",
      "27-Feb-2026;TEST1;PT CONTOH INDUK FIKTIF;600.000.000;60,00;CP",
      "27-Feb-2026;TEST-1;PT SALAH KODE;1.000;1,00;CP",
      "27-Feb-2026;TEST1;;1.000;1,00;CP",
      "28-Feb-2026;TEST1;PT TANGGAL LAIN;1.000;1,00;CP",
      "27-Feb-2026;TEST1;PT TANPA ANGKA;;;CP",
      "27-Feb-2026;TEST1;PT PERSEN SALAH;1.000;101,00;CP",
      "27-Feb-2026;TEST1;PT TIPE ANEH;1.000;1,00;Corporate Holding Company",
    ].join("\n");
    const result = await parseOwnershipFile(encode(csv), "csv", ctx("2026-02"));
    expect(result.stats).toMatchObject({ records: 7, rowsAccepted: 2, rowsRejected: 5 });
    expect(result.issues.map((issue) => [issue.locator, issue.severity, issue.field ?? null, issue.message])).toEqual([
      ["r3", "error", "ticker", 'invalid share code "TEST-1"'],
      ["r4", "error", "holderName", "missing holder name"],
      ["r5", "error", "date", "date 2026-02-28 differs from the file's position date 2026-02-27"],
      ["r6", "error", null, "neither shares nor percentage is stated"],
      ["r7", "error", "percent", 'percentage "101,00" is above 100'],
      ["r8", "warning", "investorType", 'unusual investor type "CORPORATE HOLDING COMPANY"; kept as stated'],
    ]);
  });

  it("fails a file with no valid row, keeping the row errors", async () => {
    const csv = "SHARE_CODE,INVESTOR_NAME,PERCENTAGE\nTEST-1,PT X,1\n";
    const failure = await parseOwnershipFile(encode(csv), "csv", ctx("2026-02", { snapshotDate: "2026-02-27" })).catch((error) => error);
    expect(failure).toBeInstanceOf(OwnershipFileError);
    expect(failure.message).toMatch(/No valid rows/);
    expect(failure.issues).toHaveLength(1);
  });

  it("needs a position date from somewhere", async () => {
    const csv = "SHARE_CODE,INVESTOR_NAME,PERCENTAGE\nTEST1,PT X,1\n";
    await expect(parseOwnershipFile(encode(csv), "csv", ctx("2026-02"))).rejects.toThrow(/Pass snapshotDate/);
    const ok = await parseOwnershipFile(encode(csv), "csv", ctx("2026-02", { snapshotDate: "2026-02-27" }));
    expect(ok.snapshotDate).toBe("2026-02-27");
  });

  it("reads an XLSX export: shared strings, numeric shares, percent-formatted fractions and date serials", async () => {
    const xlsx = syntheticOwnershipXlsx({ ...MAR_2026, isoDate: "2026-03-31" });
    expect(detectFormat(xlsx, null, null)).toBe("xlsx");
    const result = await parseOwnershipFile(xlsx, "xlsx", ctx("2026-03"));
    const csv = await parseOwnershipFile(encode(syntheticOwnershipCsv(MAR_2026)), "csv", ctx("2026-03"));
    expect(result.snapshotDate).toBe("2026-03-31");
    expect(rowsOf(result)).toEqual(rowsOf(csv));
    expect(result.issues).toEqual([expect.objectContaining({ severity: "error", locator: "r12", field: "shares" })]);
  });

  it("splits CSV with quoted delimiters and newlines", () => {
    expect(splitCsv('a;"b;c";"d\n""e"""\r\nf;g', ";")).toEqual([["a", "b;c", 'd\n"e"'], ["f", "g"]]);
    expect(() => splitCsv('a,"b', ",")).toThrow(/unterminated/);
  });
});

describe("format detection and holder kinds", () => {
  it("detects by magic bytes, then by type or name for text", () => {
    expect(detectFormat(committed("synthetic-1pct-2026-02.pdf"), "application/octet-stream", "x.bin")).toBe("pdf");
    expect(detectFormat(encode("a,b\n"), "text/csv", null)).toBe("csv");
    expect(detectFormat(encode("a,b\n"), null, "list.csv")).toBe("csv");
    expect(detectFormat(new Uint8Array([0x00, 0x01, 0x02]), "application/octet-stream", null)).toBeNull();
    expect(detectFormat(encode("<html>"), "image/png", "x.png")).toBeNull();
  });

  it("maps investor types and names to the six HAKA-33 kinds", () => {
    expect(holderKindFor("BUDI CONTOH", "ID")).toBe("person");
    expect(holderKindFor("PT CONTOH", "CP")).toBe("organisation");
    expect(holderKindFor("REKSA DANA CONTOH", "MF")).toBe("organisation");
    expect(holderKindFor("DUMMY BANK A/C CLIENTS", "CP")).toBe("custodian_nominee");
    expect(holderKindFor("UOB KAY HIAN PRIVATE LIMITED", "SC")).toBe("custodian_nominee");
    expect(holderKindFor("NEGARA REPUBLIK INDONESIA", "OT")).toBe("government");
    expect(holderKindFor("Masyarakat", null)).toBe("public");
    expect(holderKindFor("PT CONTOH INVESTAMA", "OT")).toBe("organisation");
    expect(holderKindFor("SANTOSO", null)).toBe("unknown");
  });
});
