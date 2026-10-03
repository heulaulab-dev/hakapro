/**
 * Removes tax / government / registry identifiers from provider records at the parsing boundary, so they
 * can never reach an API response, a log, or the UI. IDX company details carry NPWP and NPKP (company tax
 * registration numbers) and internal row ids; individuals could carry NIK/KTP/SID/passport numbers.
 *
 * Two layers: keys that name an identifier are dropped, and any remaining string that looks like one
 * (NPWP pattern, or ≥15 digits once separators are removed) is dropped too.
 */
const IDENTIFIER_KEY = /^(npwp|npkp|nik|ktp|no_?ktp|sid|single_?investor_?id|passport|paspor|tin|tax_?id|id|data_?id|nomor_?identitas|no_?identitas)$/i;
const IDENTIFIER_KEY_PART = /npwp|npkp|ktp|passport|paspor|identitas|tax_?id/i;
/** 99.999.999.9-999.999 (15-digit) and 9999.9999.9999.9999 (16-digit NPWP/NIK) shapes, with any separators. */
const NPWP_SHAPE = /^\d{2}[.\s-]?\d{3}[.\s-]?\d{3}[.\s-]?\d[.\s-]?\d{3}[.\s-]?\d{3}$/;

export function isIdentifierKey(key: string): boolean {
  return IDENTIFIER_KEY.test(key) || IDENTIFIER_KEY_PART.test(key);
}

export function looksLikeIdentifier(value: string): boolean {
  const trimmed = value.trim();
  if (NPWP_SHAPE.test(trimmed)) return true;
  return /^[\d.\s/-]+$/.test(trimmed) && trimmed.replace(/\D/g, "").length >= 15;
}

export function stripIdentifiers<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripIdentifiers(item)) as T;
  if (value && typeof value === "object") {
    const clean: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isIdentifierKey(key)) continue;
      if (typeof child === "string" && looksLikeIdentifier(child)) continue;
      clean[key] = stripIdentifiers(child);
    }
    return clean as T;
  }
  return value;
}
