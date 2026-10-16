// IDX session dates for ingest: which session a source's data belongs to, and when that session is final.
import { IDX_CALENDAR, toMinutes } from "@/server/config/idx-calendar";
import { isTradingDay, jakartaClock, previousTradingDay } from "@/lib/freshness/session";

const WIB_OFFSET_SECONDS = 7 * 3600;

/** WIB calendar date of an epoch-seconds timestamp (Yahoo bars carry their exchange `gmtoffset`). */
export function wibDateOfEpoch(epochSeconds: number, gmtoffset = WIB_OFFSET_SECONDS): string {
  return new Date((epochSeconds + gmtoffset) * 1000).toISOString().slice(0, 10);
}

/** ISO timestamp on the WIB wall clock (`2026-10-16T10:20:00+07:00`), so its first 10 characters are the WIB date. */
export function wibIso(at: Date): string {
  return `${new Date(at.getTime() + WIB_OFFSET_SECONDS * 1000).toISOString().slice(0, 19)}+07:00`;
}

/** WIB calendar date of an instant. */
export function wibDateOf(at: Date): string {
  return new Date(at.getTime() + WIB_OFFSET_SECONDS * 1000).toISOString().slice(0, 10);
}

/** True once today's session is over and its data is final (after the calendar's `finalAfter`, 16:15 WIB). */
export function sessionFinal(at: Date): boolean {
  const clock = jakartaClock(at);
  return isTradingDay(clock.date) && clock.minutes >= toMinutes(IDX_CALENDAR.finalAfter);
}

/** The newest session whose data is final at `at`: today after the close, otherwise the previous trading day. */
export function lastCompletedSession(at: Date): string {
  const clock = jakartaClock(at);
  return sessionFinal(at) ? clock.date : previousTradingDay(clock.date);
}

/** Today's WIB date. */
export function wibToday(at: Date): string {
  return jakartaClock(at).date;
}

/** `YYYY-MM-DD` plus `days`. */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Epoch seconds of 00:00 WIB on a date (Yahoo `period1`/`period2`). */
export function wibMidnightEpoch(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00+07:00`) / 1000;
}
