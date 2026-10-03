/**
 * The only place numbers, money, units and dates are formatted. Components never format themselves.
 *
 * Abbreviation collision: Indonesian "M" = miliar (10^9) and "T" = triliun (10^12); English "M" =
 * million, "B" = billion, "T" = trillion. Suffixes therefore come from an explicit per-locale table,
 * never from Intl's compact notation (whose output varies by ICU version).
 *
 * Inputs follow the domain conventions: percent fields are percent units (1.25 = 1.25%), volumes are
 * shares unless stated, money is IDR.
 */

export type Locale = "id" | "en";
export const EMPTY = "—";

const INTL_LOCALE: Record<Locale, string> = { id: "id-ID", en: "en-US" };

/** Largest first. `space` separates number and suffix ("1,5 T" vs "1.5T"). */
const SCALES: Record<Locale, { space: boolean; steps: Array<[number, string]> }> = {
  id: { space: true, steps: [[1e12, "T"], [1e9, "M"], [1e6, "jt"], [1e3, "rb"]] },
  en: { space: false, steps: [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]] },
};

const UNIT_LABELS: Record<Locale, { shares: string; lots: string; lot: string; share: string }> = {
  id: { shares: "lembar", share: "lembar", lots: "lot", lot: "lot" },
  en: { shares: "shares", share: "share", lots: "lots", lot: "lot" },
};

export const SHARES_PER_LOT = 100;

const isNumber = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

function numberFormat(locale: Locale, minimumFractionDigits: number, maximumFractionDigits: number) {
  return new Intl.NumberFormat(INTL_LOCALE[locale], { minimumFractionDigits, maximumFractionDigits, useGrouping: true });
}

/** Plain grouped number: 1234567.5 → "1.234.567,5" (id) / "1,234,567.5" (en). */
export function formatNumber(value: number | null | undefined, locale: Locale, options: { decimals?: number; minDecimals?: number } = {}): string {
  if (!isNumber(value)) return EMPTY;
  const max = options.decimals ?? 2;
  return numberFormat(locale, Math.min(options.minDecimals ?? 0, max), max).format(normalizeZero(value));
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

/**
 * Abbreviated magnitude without currency/unit: 1.5e12 → "1,5 T" (id) / "1.5T" (en).
 * Values below 1,000 are shown in full.
 */
export function formatCompact(value: number | null | undefined, locale: Locale, options: { decimals?: number } = {}): string {
  if (!isNumber(value)) return EMPTY;
  const decimals = options.decimals ?? 2;
  const { space, steps } = SCALES[locale];
  const magnitude = Math.abs(value);
  for (let index = 0; index < steps.length; index += 1) {
    const [factor, suffix] = steps[index];
    if (magnitude < factor) continue;
    const scaled = round(value / factor, decimals);
    // 999,999 rounds to "1.000 rb"; promote to the next unit instead.
    if (Math.abs(scaled) >= 1000 && index > 0) {
      const [biggerFactor, biggerSuffix] = steps[index - 1];
      return join(numberFormat(locale, 0, decimals).format(round(value / biggerFactor, decimals)), biggerSuffix, space);
    }
    return join(numberFormat(locale, 0, decimals).format(scaled), suffix, space);
  }
  const rounded = round(value, decimals);
  if (Math.abs(rounded) >= 1000) return join(numberFormat(locale, 0, decimals).format(round(value / steps.at(-1)![0], decimals)), steps.at(-1)![1], space);
  return numberFormat(locale, 0, decimals).format(normalizeZero(rounded));
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return normalizeZero(Math.round(value * factor) / factor);
}

function join(number: string, suffix: string, space: boolean): string {
  return space ? `${number} ${suffix}` : `${number}${suffix}`;
}

/**
 * Rupiah. Prices are shown in full ("Rp6.300"); large values may be abbreviated
 * ("Rp1,5 T" id / "Rp1.5T" en). Negative values put the sign before the currency.
 */
export function formatIdr(value: number | null | undefined, locale: Locale, options: { compact?: boolean; decimals?: number } = {}): string {
  if (!isNumber(value)) return EMPTY;
  const sign = value < 0 && round(Math.abs(value), options.decimals ?? 0) !== 0 ? "-" : "";
  const body = options.compact
    ? formatCompact(Math.abs(value), locale, { decimals: options.decimals ?? 2 })
    : formatNumber(Math.abs(value), locale, { decimals: options.decimals ?? 0 });
  return `${sign}Rp${body}`;
}

/** Percent units in, explicit sign out: 1.25 → "+1,25%" (id) / "+1.25%" (en); zero has no sign. */
export function formatPercent(value: number | null | undefined, locale: Locale, options: { decimals?: number; signed?: boolean } = {}): string {
  if (!isNumber(value)) return EMPTY;
  const decimals = options.decimals ?? 2;
  const rounded = round(value, decimals);
  const sign = options.signed === false || rounded === 0 ? (rounded < 0 ? "-" : "") : rounded > 0 ? "+" : "-";
  return `${sign}${numberFormat(locale, decimals, decimals).format(Math.abs(rounded))}%`;
}

/** Signed absolute change, e.g. price change: -50 → "-50" / 25 → "+25". */
export function formatChange(value: number | null | undefined, locale: Locale, options: { decimals?: number } = {}): string {
  if (!isNumber(value)) return EMPTY;
  const decimals = options.decimals ?? 0;
  const rounded = round(value, decimals);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${numberFormat(locale, 0, decimals).format(Math.abs(rounded))}`;
}

export type VolumeUnit = "shares" | "lots";

/**
 * Volume with an always-visible unit. Input is shares; `unit: "lots"` converts (1 lot = 100 shares).
 * 1_234_567 shares → "1,23 jt lembar" / "1.23M shares" (compact) or "12.345 lot" / "12,345 lots".
 */
export function formatVolume(shares: number | null | undefined, locale: Locale, options: { unit?: VolumeUnit; compact?: boolean } = {}): string {
  if (!isNumber(shares)) return EMPTY;
  const unit = options.unit ?? "shares";
  const amount = unit === "lots" ? shares / SHARES_PER_LOT : shares;
  const text = options.compact ? formatCompact(amount, locale) : formatNumber(amount, locale, { decimals: unit === "lots" ? 2 : 0 });
  const labels = UNIT_LABELS[locale];
  const singular = Math.abs(amount) === 1;
  const label = unit === "lots" ? (singular ? labels.lot : labels.lots) : singular ? labels.share : labels.shares;
  return `${text} ${label}`;
}

const MONTH_ONLY = /^\d{4}-\d{2}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Data dates. "2026-09-18" → "18 Sep 2026"; "2026-09" → "Sep 2026"; timestamps add a WIB time.
 * Date-only and month-only values are calendar dates, not instants, so no timezone shift applies.
 */
export function formatDate(value: string | null | undefined, locale: Locale): string {
  if (!value) return EMPTY;
  const intl = INTL_LOCALE[locale];
  if (MONTH_ONLY.test(value)) {
    const date = new Date(`${value}-01T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? EMPTY : new Intl.DateTimeFormat(intl, { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  }
  if (DATE_ONLY.test(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? EMPTY : new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  }
  // Timestamps without an offset are provider wall-clock times in WIB.
  const instant = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}+07:00`);
  if (Number.isNaN(instant.getTime())) return EMPTY;
  // Assembled from parts so server and browser ICU versions cannot disagree on punctuation.
  const wib = new Date(instant.getTime() + 7 * 3_600_000).toISOString();
  const time = locale === "id" ? `${wib.slice(11, 13)}.${wib.slice(14, 16)}` : `${wib.slice(11, 16)}`;
  return `${formatDate(wib.slice(0, 10), locale)}${locale === "en" ? "," : ""} ${time} WIB`;
}

/** Period strings from the API: "Q1 2026" passes through; "2020-01/2026-09" → "Jan 2020 – Sep 2026". */
export function formatPeriod(value: string | null | undefined, locale: Locale): string {
  if (!value) return EMPTY;
  const range = /^(\d{4}-\d{2}(?:-\d{2})?)\/(\d{4}-\d{2}(?:-\d{2})?)$/.exec(value);
  return range ? `${formatDate(range[1], locale)} – ${formatDate(range[2], locale)}` : value;
}

/** Direction for color semantics; null stays neutral. */
export function direction(value: number | null | undefined): "positive" | "negative" | "neutral" {
  return !isNumber(value) || value === 0 ? "neutral" : value > 0 ? "positive" : "negative";
}

export type ValueFormat = "idr" | "idrCompact" | "percent" | "number" | "compact" | "shares" | "sharesCompact" | "lots";

/** One entry point for components that receive a raw number plus a declared format. */
export function formatValue(value: number | null | undefined, format: ValueFormat, locale: Locale): string {
  switch (format) {
    case "idr": return formatIdr(value, locale);
    case "idrCompact": return formatIdr(value, locale, { compact: true });
    case "percent": return formatPercent(value, locale);
    case "number": return formatNumber(value, locale);
    case "compact": return formatCompact(value, locale);
    case "shares": return formatVolume(value, locale);
    case "sharesCompact": return formatVolume(value, locale, { compact: true });
    case "lots": return formatVolume(value, locale, { unit: "lots" });
  }
}
