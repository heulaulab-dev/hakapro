const MONTHS: Record<string, number> = {
  januari: 1, jan: 1, februari: 2, feb: 2, maret: 3, mar: 3, april: 4, apr: 4, mei: 5,
  juni: 6, jun: 6, juli: 7, jul: 7, agustus: 8, agu: 8, ags: 8, aug: 8, september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10, oct: 10, november: 11, nov: 11, desember: 12, des: 12, dec: 12,
};

/**
 * Extracts an ISO date from provider prose such as
 * "📊 **SCREENER V5.2** — Jumat, 18 September 2026" → "2026-09-18".
 * Returns null when no unambiguous, valid calendar date is present.
 */
export function parseIndonesianDate(text: string): string | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  const match = /\b(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})\b/.exec(text);
  let year: number, month: number, day: number;
  if (match && MONTHS[match[2].toLowerCase()]) {
    day = Number(match[1]);
    month = MONTHS[match[2].toLowerCase()];
    year = Number(match[3]);
  } else if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}
