// Number and date parsing for the ≥1% shareholder list (CONNECTION-NETWORK.md §1.3: "3.200.142.830", "41,10").
// Pure and strict: anything ambiguous or malformed throws a ParseValueError with a readable message, which the
// normalizer records as a per-row validation error. Values come back as decimal strings compatible with the HAKA-33
// types (`shares` integer string, `percent` ≤ 6 decimals); no floating point is involved.

export class ParseValueError extends Error {}

const clean = (raw: string) => raw.replace(/[\s  ]/g, "");
/** Empty cells and the usual "no value" dashes. */
const isBlank = (value: string) => value === "" || /^[-–—]+$/.test(value);

/**
 * Share count: "3.200.142.830" (Indonesian), "3,200,142,830" (English), "3200142830", or with a zero fraction
 * ("3.200.142.830,00"). Returns null for an empty cell. Rejects negatives, non-zero fractions and mixed grouping.
 */
export function parseShares(raw: string): string | null {
  const value = clean(raw);
  if (isBlank(value)) return null;
  if (/^-/.test(value) || /^\(.*\)$/.test(value)) throw new ParseValueError(`negative share count "${raw.trim()}"`);
  let integer = value;
  // A trailing decimal part (",00" / ".00": one or two digits after the last separator) must be zero.
  const last = Math.max(value.lastIndexOf("."), value.lastIndexOf(","));
  if (last >= 0 && value.length - last - 1 <= 2) {
    const head = value.slice(0, last);
    if (head.includes(value[last]) || !/^\d/.test(head)) throw new ParseValueError(`unreadable share count "${raw.trim()}"`);
    if (/[^0]/.test(value.slice(last + 1))) throw new ParseValueError(`share count "${raw.trim()}" has a fraction`);
    integer = head;
  }
  if (/^\d+$/.test(integer)) return normalizeInteger(integer, raw);
  const grouped = /^\d{1,3}(?:([.,])\d{3})(?:\1\d{3})*$/.exec(integer);
  if (!grouped) throw new ParseValueError(`unreadable share count "${raw.trim()}"`);
  return normalizeInteger(integer.replace(/[.,]/g, ""), raw);
}

function normalizeInteger(digits: string, raw: string): string {
  const trimmed = digits.replace(/^0+(?=\d)/, "");
  if (trimmed.length > 24) throw new ParseValueError(`share count "${raw.trim()}" is too large`);
  return trimmed;
}

/**
 * Percentage of issued shares: "41,10", "41.10", "41,10%", "0,9", "5". A percentage never needs a thousands separator
 * (it is at most 100), so a single "," or "." is the decimal mark. With both, the last one is the decimal mark and the
 * value must still be at most 100. Returns null for an empty cell; rounds excess source precision to the database's
 * 6 decimals (`numeric(9,6)`) using decimal string arithmetic.
 */
export function parsePercent(raw: string): string | null {
  let value = clean(raw).replace(/%$/, "");
  if (isBlank(value)) return null;
  if (/^-/.test(value)) throw new ParseValueError(`negative percentage "${raw.trim()}"`);
  const marks = value.match(/[.,]/g) ?? [];
  if (marks.length > 1) {
    const decimal = value.lastIndexOf(",") > value.lastIndexOf(".") ? "," : ".";
    const grouping = decimal === "," ? "." : ",";
    const head = value.slice(0, value.lastIndexOf(decimal));
    if (head.includes(decimal) || !/^\d{1,3}(?:[.,]\d{3})*$/.test(head)) throw new ParseValueError(`unreadable percentage "${raw.trim()}"`);
    value = head.split(grouping).join("") + "." + value.slice(value.lastIndexOf(decimal) + 1);
  } else {
    value = value.replace(",", ".");
  }
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value);
  if (!match) throw new ParseValueError(`unreadable percentage "${raw.trim()}"`);
  const whole = match[1].replace(/^0+(?=\d)/, "");
  const decimals = (match[2] ?? "").replace(/0+$/, "");
  if (whole.length > 3 || Number(whole) > 100 || (Number(whole) === 100 && decimals !== "")) {
    throw new ParseValueError(`percentage "${raw.trim()}" is above 100`);
  }
  if (decimals.length <= 6) return decimals ? `${whole}.${decimals}` : whole;

  const scale = 1_000_000n;
  const retained = BigInt(whole) * scale + BigInt(decimals.slice(0, 6));
  const rounded = retained + (decimals[6] >= "5" ? 1n : 0n);
  const roundedWhole = (rounded / scale).toString();
  const roundedDecimals = (rounded % scale).toString().padStart(6, "0").replace(/0+$/, "");
  return roundedDecimals ? `${roundedWhole}.${roundedDecimals}` : roundedWhole;
}

const MONTHS: Record<string, number> = {
  JAN: 1, JANUARI: 1, JANUARY: 1,
  FEB: 2, FEBRUARI: 2, FEBRUARY: 2, PEB: 2, PEBRUARI: 2,
  MAR: 3, MARET: 3, MARCH: 3,
  APR: 4, APRIL: 4,
  MEI: 5, MAY: 5,
  JUN: 6, JUNI: 6, JUNE: 6,
  JUL: 7, JULI: 7, JULY: 7,
  AGU: 8, AGT: 8, AGS: 8, AGUSTUS: 8, AUG: 8, AUGUST: 8,
  SEP: 9, SEPT: 9, SEPTEMBER: 9,
  OKT: 10, OKTOBER: 10, OCT: 10, OCTOBER: 10,
  NOV: 11, NOPEMBER: 11, NOVEMBER: 11,
  DES: 12, DESEMBER: 12, DEC: 12, DECEMBER: 12,
};

const iso = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

function validDate(year: number, month: number, day: number, raw: string): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || month > 12 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ParseValueError(`"${raw.trim()}" is not a calendar date`);
  }
  return iso(year, month, day);
}

/**
 * Position date: "27-Feb-2026", "27-Feb-26", "27 Februari 2026", "2026-02-27", "27/02/2026" (day first, as in
 * Indonesia). Returns null for an empty cell.
 */
export function parseListDate(raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, " ");
  if (isBlank(value)) return null;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]), raw);
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  if (match) return validDate(Number(match[3]), Number(match[2]), Number(match[1]), raw);
  match = /^(\d{1,2})[ -]([A-Za-z]+)\.?[ -](\d{2}|\d{4})$/.exec(value);
  if (match) {
    const month = MONTHS[match[2].toUpperCase()];
    if (!month) throw new ParseValueError(`unknown month in "${raw.trim()}"`);
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return validDate(year, month, Number(match[1]), raw);
  }
  throw new ParseValueError(`unreadable date "${raw.trim()}"`);
}

/** "2026-02" → true for a real month. */
export function isMonth(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return Boolean(match) && Number(match![2]) >= 1 && Number(match![2]) <= 12 && Number(match![1]) >= 2000;
}

/** "2026-03" → "2026-02". */
export function previousMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return m === 1 ? `${year - 1}-12` : `${year}-${String(m - 1).padStart(2, "0")}`;
}

/** "2026-02" → "2026-03". */
export function nextMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
}
