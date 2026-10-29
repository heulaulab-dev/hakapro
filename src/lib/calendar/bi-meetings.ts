/** Published 22 December 2025 by Bank Indonesia. Dates are the two-day RDG meeting, not a promised announcement time. */
export const BI_RDG_2026_SOURCE = "https://www.bi.go.id/id/publikasi/ruang-media/news-release/Pages/sp_2730825.aspx";
export const BI_RDG_2026_PUBLISHED = "2025-12-22";

export const BI_RDG_2026 = [
  { start: "2026-01-20", end: "2026-01-21" },
  { start: "2026-02-18", end: "2026-02-19" },
  { start: "2026-03-16", end: "2026-03-17" },
  { start: "2026-04-21", end: "2026-04-22" },
  { start: "2026-05-19", end: "2026-05-20" },
  { start: "2026-06-17", end: "2026-06-18" },
  { start: "2026-07-21", end: "2026-07-22" },
  { start: "2026-08-18", end: "2026-08-19" },
  { start: "2026-09-22", end: "2026-09-23" },
  { start: "2026-10-20", end: "2026-10-21" },
  { start: "2026-11-17", end: "2026-11-18" },
  { start: "2026-12-15", end: "2026-12-16" },
] as const;

/** Official Federal Reserve FOMC meeting dates. Release time is the customary 14:00 ET statement time. */
export const FOMC_2026_SOURCE = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
export const FOMC_2026 = [
  { start: "2026-01-27", end: "2026-01-28", dst: false },
  { start: "2026-03-17", end: "2026-03-18", dst: true },
  { start: "2026-04-28", end: "2026-04-29", dst: true },
  { start: "2026-06-16", end: "2026-06-17", dst: true },
  { start: "2026-07-28", end: "2026-07-29", dst: true },
  { start: "2026-09-15", end: "2026-09-16", dst: true },
  { start: "2026-10-27", end: "2026-10-28", dst: true },
  { start: "2026-12-08", end: "2026-12-09", dst: false },
] as const;

export const BPS_RELEASES_SOURCE = "https://www.bps.go.id/id/arc";

/** Typical BPS release dates, explicitly estimates until an exact date is confirmed by a provider. */
export function bpsEstimateDates(today: string): Array<{ kind: "inflation" | "gdp"; date: string }> {
  const start = new Date(`${today}T00:00:00Z`);
  const until = new Date(start.getTime() + 21 * 86_400_000);
  const events: Array<{ kind: "inflation" | "gdp"; date: string }> = [];
  const nextBusinessDay = (year: number, month: number, day: number) => {
    const date = new Date(Date.UTC(year, month, day));
    while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  };
  for (let offset = -1; offset <= 1; offset += 1) {
    const monthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + offset, 1));
    const year = monthStart.getUTCFullYear(), month = monthStart.getUTCMonth();
    const inflation = nextBusinessDay(year, month, 1);
    if (inflation >= today && inflation <= until.toISOString().slice(0, 10)) events.push({ kind: "inflation", date: inflation });
    if ([1, 4, 7, 10].includes(month)) {
      const gdp = nextBusinessDay(year, month, 5);
      if (gdp >= today && gdp <= until.toISOString().slice(0, 10)) events.push({ kind: "gdp", date: gdp });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}
