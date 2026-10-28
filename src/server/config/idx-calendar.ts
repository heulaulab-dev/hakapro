/**
 * IDX trading schedule and exchange-holiday calendar (Asia/Jakarta, WIB = UTC+7, no DST).
 *
 * TODO(verify): every time and holiday below must be checked against IDX's official trading-hours
 * page and the annual exchange-holiday announcement (Pengumuman Hari Libur Bursa). Until then the
 * classifier is built so that errors land on the less fresh label:
 *   - today's data counts as EOD only after `finalAfter` (post-trading end), never at the bell;
 *   - a missing holiday makes a stale dataset look older (STALE), never newer;
 *   - a listed date that was actually a trading day yields UNAVAILABLE for that day's data.
 */

export type HHMM = `${number}:${number}`;
export type Session = { start: HHMM; end: HHMM };

export const IDX_CALENDAR = {
  timeZone: "Asia/Jakarta",
  /** Regular-market sessions by weekday group. TODO(verify) */
  sessions: {
    mondayToThursday: [
      { start: "09:00", end: "12:00" },
      { start: "13:30", end: "15:49" },
    ],
    friday: [
      { start: "09:00", end: "11:30" },
      { start: "14:00", end: "15:49" },
    ],
  } satisfies Record<string, Session[]>,
  /** Pre-closing/closing auction and post-trading run until this time; only after it is today's data final. TODO(verify) */
  finalAfter: "16:15" as HHMM,
  /**
   * Exchange holidays (YYYY-MM-DD). Only fixed-date national holidays are listed so far;
   * moveable religious holidays and cuti bersama for each year are TODO(verify).
   */
  holidays: {
    2020: ["2020-01-01"],
    2026: ["2026-01-01", "2026-05-01", "2026-06-01", "2026-08-17", "2026-12-25"],
  } as Record<number, string[]>,
} as const;

export function toMinutes(time: HHMM): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function sessionsFor(weekday: number): Session[] {
  if (weekday === 0 || weekday === 6) return [];
  return weekday === 5 ? IDX_CALENDAR.sessions.friday : IDX_CALENDAR.sessions.mondayToThursday;
}

export function isHoliday(isoDate: string): boolean {
  return IDX_CALENDAR.holidays[Number(isoDate.slice(0, 4))]?.includes(isoDate) ?? false;
}

/** Years with a holiday list; outside them, unknown holidays can only make data look older. */
export function hasHolidayCalendar(year: number): boolean {
  return year in IDX_CALENDAR.holidays;
}
