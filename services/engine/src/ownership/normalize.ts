// RawTable → validated HAKA-33 snapshot rows, grouped per issuer. Per-row problems are collected as issues (the row is
// dropped on an error), never thrown; only a file-level problem (no position date, a date outside the upload month,
// no valid row) fails the upload.
//
// Kept fields only: ticker, issuer name, holder name, investor type and local/foreign as stated, shares, percent and
// the issuer's issued shares if a column states it. Every other column (nationality, domicile, addresses, any
// identifier) is dropped here, so nothing ID-like can reach storage (MIGRATION §10.5).
import { holderKind as insiderHolderKind } from "@/lib/insider-holders";
import { ownershipHolderKey, ownershipSnapshotRowSchema, type OwnershipHolderKind, type OwnershipSnapshotRow } from "@/lib/ownership/snapshot";
import type { OwnershipField } from "./layout";
import { parseListDate, parsePercent, parseShares, ParseValueError } from "./numbers";
import { OwnershipFileError, type ParseIssue, type RawTable } from "./raw-table";

/** Dataset id of the KSEI ≥1% list uploaded by the owner (OwnershipSource.dataset). */
export const OWNERSHIP_DATASET = "ksei-1pct-manual-upload";
/** The list shows holders at or above 1 % of issued shares. */
export const OWNERSHIP_THRESHOLD_PERCENT = "1";

export type ParseContext = {
  /** Upload month (YYYY-MM): the position date must fall in it. */
  month: string;
  /** Position date given by the owner; overrides a title date, and rows with another DATE are rejected. */
  snapshotDate?: string | null;
  /** When HAKAPRO read the file (the upload time): OwnershipSource.retrievedAt. */
  retrievedAt: string;
  /** Row source references are `${referencePrefix}#${locator}`, e.g. "upload:<id>#p3.l12". */
  referencePrefix: string;
  dataset?: string;
};

export type NormalizedRow = OwnershipSnapshotRow & { investorType: string | null; localForeign: string | null; lineNo: number };
export type NormalizedIssuer = { ticker: string; issuerName: string | null; issuedShares: string | null; rows: NormalizedRow[] };
export type NormalizedFile = {
  snapshotDate: string;
  issuers: NormalizedIssuer[];
  issues: ParseIssue[];
  stats: { records: number; rowsAccepted: number; rowsRejected: number; issuers: number; warnings: number };
};

const TICKER = /^[A-Z0-9]{1,12}$/;
const CODE = /^[A-Z0-9/ -]{1,16}$/;
/** Aggregate lines, never holders (CONNECTION-NETWORK.md §1.2): "Masyarakat", "Public". */
const PUBLIC_AGGREGATE = /^(MASYARAKAT|PUBLIC|PUBLIK)\b/;
/** The Republic of Indonesia as a direct holder. Deliberately narrow: state-owned companies stay organisations. */
const GOVERNMENT = /\b(NEGARA REPUBLIK INDONESIA|REPUBLIK INDONESIA|REPUBLIC OF INDONESIA|PEMERINTAH REPUBLIK INDONESIA)\b/;
/** KSEI investor-type codes for non-individuals (CP corporate, IB financial institution, MF mutual fund, IS insurance, PF pension fund, SC securities company, FD foundation). */
const ORGANISATION_TYPES = new Set(["CP", "IB", "MF", "IS", "PF", "SC", "FD"]);

/**
 * Holder kind for a ≥1% line, from the stated investor type and the existing name helpers (insider-holders.ts):
 * aggregates → public; the Republic → government; custodian/nominee account names → custodian_nominee (before the
 * type, since a nominee account is registered as a corporate); type ID → person; organisation types → organisation;
 * otherwise (OT, blank, unknown codes) the name heuristics, which fall back to unknown.
 */
export function holderKindFor(name: string, investorType: string | null): OwnershipHolderKind {
  const upper = name.toUpperCase().replace(/\s+/g, " ").trim();
  if (PUBLIC_AGGREGATE.test(upper)) return "public";
  if (GOVERNMENT.test(upper)) return "government";
  const byName = insiderHolderKind(upper, []);
  if (byName === "nominee") return "custodian_nominee";
  if (investorType === "ID") return "person";
  if (investorType && ORGANISATION_TYPES.has(investorType)) return "organisation";
  return byName === "organization" ? "organisation" : byName;
}

const issueFor = (locator: string, text: string, field: OwnershipField | undefined, message: string, severity: ParseIssue["severity"] = "error"): ParseIssue =>
  ({ severity, locator, ...(field ? { field } : {}), message, text: text.slice(0, 300) });

function value<T>(parse: (raw: string) => T, raw: string | undefined, onError: (message: string) => void): T | null | undefined {
  if (raw === undefined) return undefined;
  try {
    return parse(raw);
  } catch (error) {
    if (error instanceof ParseValueError) { onError(error.message); return undefined; }
    throw error;
  }
}

const code = (raw: string | undefined) => {
  const text = raw?.trim().toUpperCase().replace(/\s+/g, " ");
  return text ? text : null;
};

export function normalizeTable(table: RawTable, ctx: ParseContext): NormalizedFile {
  const issues: ParseIssue[] = [...table.issues];
  const dataset = ctx.dataset ?? OWNERSHIP_DATASET;

  // Position date: the owner's snapshotDate, else the first readable DATE cell, else a title line.
  let fileDate = ctx.snapshotDate ?? null;
  if (!fileDate) {
    for (const record of table.records) {
      try {
        fileDate = record.cells.date ? parseListDate(record.cells.date) : null;
      } catch { /* reported per row below */ }
      if (fileDate) break;
    }
  }
  if (!fileDate && table.titleDate) {
    try { fileDate = parseListDate(table.titleDate); } catch { /* falls through to the error */ }
  }
  if (!fileDate) throw new OwnershipFileError("No position date: the file has no readable DATE column or title date. Pass snapshotDate=YYYY-MM-DD with the upload.");
  if (fileDate.slice(0, 7) !== ctx.month) throw new OwnershipFileError(`The position date ${fileDate} is not in the upload month ${ctx.month}. Check asOf (or snapshotDate).`);

  const issuers = new Map<string, NormalizedIssuer>();
  let accepted = 0;
  let rejected = 0;

  table.records.forEach((record, index) => {
    const before = issues.length;
    const fail = (field: OwnershipField | undefined, message: string) => issues.push(issueFor(record.locator, record.text, field, message));
    const cells = record.cells;

    const ticker = cells.ticker?.trim().toUpperCase() ?? "";
    if (!TICKER.test(ticker)) fail("ticker", ticker ? `invalid share code "${cells.ticker}"` : "missing share code");
    const holderName = cells.holderName?.replace(/\s+/g, " ").trim() ?? "";
    if (!holderName) fail("holderName", "missing holder name");

    const date = value(parseListDate, cells.date, (message) => fail("date", message));
    if (date && date !== fileDate) fail("date", `date ${date} differs from the file's position date ${fileDate}`);

    let shares = value(parseShares, cells.shares, (message) => fail("shares", message));
    const scripless = value(parseShares, cells.sharesScripless, (message) => fail("sharesScripless", message));
    const scrip = value(parseShares, cells.sharesScrip, (message) => fail("sharesScrip", message));
    const parts = [scripless, scrip].filter((part): part is string => typeof part === "string");
    if (parts.length) {
      const sum = parts.reduce((total, part) => total + BigInt(part), BigInt(0)).toString();
      if (shares === undefined || shares === null) shares = sum;
      else if (shares !== sum) issues.push(issueFor(record.locator, record.text, "shares", `total ${shares} differs from scripless + scrip ${sum}; the total is kept`, "warning"));
    }
    const percent = value(parsePercent, cells.percent, (message) => fail("percent", message));
    const sharesValue = shares ?? null;
    const percentValue = percent ?? null;
    if (sharesValue === null && percentValue === null && issues.length === before) fail(undefined, "neither shares nor percentage is stated");

    const investorType = code(cells.investorType);
    if (investorType && !CODE.test(investorType)) issues.push(issueFor(record.locator, record.text, "investorType", `unusual investor type "${investorType}"; kept as stated`, "warning"));
    const localForeign = code(cells.localForeign);
    const issuedShares = value(parseShares, cells.issuedShares, (message) => fail("issuedShares", message));

    if (issues.slice(before).some((issue) => issue.severity === "error")) { rejected += 1; return; }

    const holderKind = holderKindFor(holderName, investorType);
    const row = {
      ticker, holderKey: ownershipHolderKey(holderName, holderKind), holderName, holderKind,
      shares: sharesValue, percent: percentValue, snapshotDate: fileDate!,
      source: { dataset, reference: `${ctx.referencePrefix}#${record.locator}`, retrievedAt: ctx.retrievedAt },
    };
    const checked = ownershipSnapshotRowSchema.safeParse(row);
    if (!checked.success) {
      fail(undefined, `row failed validation: ${checked.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
      rejected += 1;
      return;
    }
    let issuer = issuers.get(ticker);
    if (!issuer) {
      issuer = { ticker, issuerName: null, issuedShares: null, rows: [] };
      issuers.set(ticker, issuer);
    }
    const issuerName = cells.issuerName?.replace(/\s+/g, " ").trim();
    if (issuerName && !issuer.issuerName) issuer.issuerName = issuerName;
    if (typeof issuedShares === "string") {
      if (issuer.issuedShares && issuer.issuedShares !== issuedShares) {
        issues.push(issueFor(record.locator, record.text, "issuedShares", `issued shares ${issuedShares} differ from ${issuer.issuedShares} on an earlier row; kept the first`, "warning"));
      } else issuer.issuedShares = issuedShares;
    }
    issuer.rows.push({ ...checked.data, investorType, localForeign, lineNo: index + 1 });
    accepted += 1;
  });

  for (const issuer of issuers.values()) {
    const total = issuer.rows.reduce((sum, row) => sum + (row.percent ? Number(row.percent) : 0), 0);
    if (total > 100.0001) issues.push({ severity: "warning", locator: issuer.ticker, message: `disclosed percentages of ${issuer.ticker} add up to ${total.toFixed(2)} % (above 100)` });
  }
  if (accepted === 0) throw new OwnershipFileError(`No valid rows: ${rejected} of ${table.records.length} rows were rejected. See the row errors.`, issues);

  return {
    snapshotDate: fileDate,
    issuers: [...issuers.values()],
    issues,
    stats: { records: table.records.length, rowsAccepted: accepted, rowsRejected: rejected, issuers: issuers.size, warnings: issues.filter((issue) => issue.severity === "warning").length },
  };
}
