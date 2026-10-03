/**
 * Parses provider-formatted number strings into numbers with explicit units.
 * Provider strings are never shown as display text (MIGRATION §9.2).
 *
 * The same provider mixes conventions: market-cap `listed_shares_label` "122.04M" means
 * 122.04 *miliar* (10^9), while analysis text "-57M lembar" means 57 *million*. Callers must
 * therefore state the scale convention per field; an abbreviation without one is rejected.
 */

export type QuantityUnit = "shares" | "lots" | "idr" | "percent" | "count";
export type Separators = "en" | "id";
/** `id`: rb/K=10^3, jt=10^6, M=10^9 (miliar), T=10^12 (triliun). `en`: K=10^3, M=10^6, B=10^9, T=10^12. */
export type ScaleConvention = "id" | "en";

export type Quantity = { value: number; unit: QuantityUnit };
export type ParseResult = { ok: true; quantity: Quantity } | { ok: false; reason: string };

export type ParseOptions = {
  unit: QuantityUnit;
  separators: Separators;
  scale?: ScaleConvention;
};

const SCALES: Record<ScaleConvention, Record<string, number>> = {
  id: { rb: 1e3, k: 1e3, jt: 1e6, m: 1e9, t: 1e12 },
  en: { k: 1e3, m: 1e6, b: 1e9, t: 1e12 },
};

const UNIT_WORDS: Record<string, QuantityUnit> = {
  lembar: "shares", saham: "shares", shares: "shares",
  lot: "lots", lots: "lots",
};

const GROUPED: Record<Separators, RegExp> = {
  en: /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$|^\d+(?:\.\d+)?$/,
  id: /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$|^\d+(?:,\d+)?$/,
};

export function parseProviderNumber(input: string, options: ParseOptions): ParseResult {
  let text = input.trim().replace(/−/g, "-").replace(/\s+/g, " ");
  if (!text) return { ok: false, reason: "empty" };

  let sign = 1;
  const signMatch = /^([+-])\s*/.exec(text);
  if (signMatch) {
    sign = signMatch[1] === "-" ? -1 : 1;
    text = text.slice(signMatch[0].length);
  }

  let declaredUnit: QuantityUnit | null = null;
  if (/^rp\.?\s*/i.test(text)) {
    declaredUnit = "idr";
    text = text.replace(/^rp\.?\s*/i, "");
    // "Rp-50" / "Rp −50" put the sign after the currency.
    const inner = /^([+-])\s*/.exec(text);
    if (inner) {
      if (signMatch) return { ok: false, reason: "double sign" };
      sign = inner[1] === "-" ? -1 : 1;
      text = text.slice(inner[0].length);
    }
  }
  if (text.endsWith("%")) {
    declaredUnit = "percent";
    text = text.slice(0, -1).trim();
  }
  const wordMatch = /\s+([a-z]+)$/i.exec(text);
  if (wordMatch && UNIT_WORDS[wordMatch[1].toLowerCase()]) {
    declaredUnit = UNIT_WORDS[wordMatch[1].toLowerCase()];
    text = text.slice(0, wordMatch.index);
  }
  if (declaredUnit && declaredUnit !== options.unit) {
    return { ok: false, reason: `unit mismatch: text says ${declaredUnit}, field expects ${options.unit}` };
  }

  let multiplier = 1;
  const suffixMatch = /([a-z]+)$/i.exec(text);
  if (suffixMatch) {
    if (!options.scale) return { ok: false, reason: `abbreviation "${suffixMatch[1]}" without a scale convention` };
    const factor = SCALES[options.scale][suffixMatch[1].toLowerCase()];
    if (!factor) return { ok: false, reason: `unknown abbreviation "${suffixMatch[1]}"` };
    multiplier = factor;
    text = text.slice(0, suffixMatch.index).trim();
  }

  // Separators and scale are independent: market-cap labels use "." decimals with Indonesian scale letters.
  const { separators } = options;
  if (!GROUPED[separators].test(text)) return { ok: false, reason: `not a ${separators}-formatted number` };

  const normalized = separators === "en" ? text.replace(/,/g, "") : text.replace(/\./g, "").replace(",", ".");
  const value = Number(normalized) * multiplier * sign;
  if (!Number.isFinite(value)) return { ok: false, reason: "not finite" };
  return { ok: true, quantity: { value: Object.is(value, -0) ? 0 : value, unit: options.unit } };
}
