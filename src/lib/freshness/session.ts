import type { Freshness } from "./index";

/**
 * IDX regular-market window in Asia/Jakarta (WIB), minutes since midnight.
 * TODO(verify): Friday break and pre-closing/post-trading phases are ignored, and
 * exchange holidays are not modelled (weekdays are treated as trading days).
 */
export const SESSION_HOURS = { open: 9 * 60, close: 16 * 60 } as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type JakartaClock = { date: string; minutes: number; weekday: number };

export function jakartaClock(now: Date): JakartaClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")), weekday };
}

function toUtcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

function shiftDays(isoDate: string, days: number): string {
  const date = toUtcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isTradingDay(isoDate: string): boolean {
  const weekday = toUtcDate(isoDate).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

export function previousTradingDay(isoDate: string): string {
  let candidate = shiftDays(isoDate, -1);
  while (!isTradingDay(candidate)) candidate = shiftDays(candidate, -1);
  return candidate;
}

function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const date = toUtcDate(value);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Classifies a provider data date against the IDX session clock.
 *   date of the session in progress  → DELAYED
 *   date of the last completed session → EOD
 *   anything older                    → STALE
 *   unparseable or in the future      → UNAVAILABLE
 * Never returns LIVE: no Phase 1 source is a realtime feed.
 */
export function classifySessionDate(dataDate: string | null | undefined, now: Date): Freshness {
  if (!dataDate) return "UNAVAILABLE";
  const day = dataDate.slice(0, 10);
  if (!isValidIsoDate(day)) return "UNAVAILABLE";

  const clock = jakartaClock(now);
  const todayIsTrading = isTradingDay(clock.date);
  const inSession = todayIsTrading && clock.minutes >= SESSION_HOURS.open && clock.minutes < SESSION_HOURS.close;
  const lastCompleted = todayIsTrading && clock.minutes >= SESSION_HOURS.close ? clock.date : previousTradingDay(clock.date);

  if (day > clock.date) return "UNAVAILABLE";
  if (inSession && day === clock.date) return "DELAYED";
  if (day === lastCompleted) return "EOD";
  if (day < lastCompleted) return "STALE";
  // Today's date before the session opened, or a non-trading day: not a session we can vouch for.
  return "UNAVAILABLE";
}
