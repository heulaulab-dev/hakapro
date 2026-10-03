/**
 * Financial-report availability expectations for IDX issuers.
 * TODO(verify) against OJK/IDX rules: quarterly (unaudited) reports are assumed due within one
 * month of period end, annual (audited) within three months. Shorter deadlines flag a dataset as
 * behind sooner, which keeps the label on the less fresh side while unverified.
 */
export const REPORTING_DEADLINE_DAYS = { quarterly: 30, annual: 90 } as const;

const QUARTER_END: Record<number, string> = { 1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31" };

/** "2026" + "1" → "2026-03-31". Annual reports end in December. Null when the period is unreadable. */
export function periodEnd(year: string, quarter: string, period: "quarterly" | "annual" | string): string | null {
  if (!/^\d{4}$/.test(year)) return null;
  if (period === "annual") return `${year}-12-31`;
  const q = Number(quarter);
  return QUARTER_END[q] ? `${year}-${QUARTER_END[q]}` : null;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Latest period end whose report should already be public on `today` (YYYY-MM-DD). */
export function expectedLatestPeriodEnd(today: string, period: "quarterly" | "annual" | string): string {
  const year = Number(today.slice(0, 4));
  const candidates: Array<{ end: string; annual: boolean }> = [];
  for (let y = year; y >= year - 2; y -= 1) {
    if (period === "annual") candidates.push({ end: `${y}-12-31`, annual: true });
    else for (const q of [4, 3, 2, 1]) candidates.push({ end: `${y}-${QUARTER_END[q]}`, annual: q === 4 });
  }
  const due = candidates.find(({ end, annual }) => addDays(end, annual ? REPORTING_DEADLINE_DAYS.annual : REPORTING_DEADLINE_DAYS.quarterly) <= today);
  return due?.end ?? `${year - 3}-12-31`;
}
