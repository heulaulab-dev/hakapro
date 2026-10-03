import { IDX_CALENDAR, isHoliday, sessionsFor, toMinutes } from "@/server/config/idx-calendar";
import type { Freshness } from "./index";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type JakartaClock = { date: string; minutes: number; weekday: number };

export function jakartaClock(now: Date): JakartaClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IDX_CALENDAR.timeZone,
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
  return sessionsFor(toUtcDate(isoDate).getUTCDay()).length > 0 && !isHoliday(isoDate);
}

export function previousTradingDay(isoDate: string): string {
  let candidate = shiftDays(isoDate, -1);
  while (!isTradingDay(candidate)) candidate = shiftDays(candidate, -1);
  return candidate;
}

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = toUtcDate(value);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export type MarketPhase = "non_trading_day" | "pre_open" | "in_progress" | "closed";

/** Phase of today's IDX trading day. The lunch break and closing auction count as in progress. */
export function marketPhase(clock: JakartaClock): MarketPhase {
  if (!isTradingDay(clock.date)) return "non_trading_day";
  const sessions = sessionsFor(clock.weekday);
  if (clock.minutes < toMinutes(sessions[0].start)) return "pre_open";
  if (clock.minutes < toMinutes(IDX_CALENDAR.finalAfter)) return "in_progress";
  return "closed";
}

/**
 * Classifies a provider data date against the IDX calendar (src/server/config/idx-calendar.ts).
 *   date of today's session while it is in progress (incl. lunch break, closing auction) → DELAYED
 *   date of the last completed session → EOD
 *   anything older → STALE
 *   unparseable, in the future, or not a session we can vouch for → UNAVAILABLE
 * Never returns LIVE: no Phase 1 source is a realtime feed.
 */
export function classifySessionDate(dataDate: string | null | undefined, now: Date): Freshness {
  if (!dataDate) return "UNAVAILABLE";
  const day = dataDate.slice(0, 10);
  if (!isValidIsoDate(day)) return "UNAVAILABLE";

  const clock = jakartaClock(now);
  const phase = marketPhase(clock);
  const lastCompleted = phase === "closed" ? clock.date : previousTradingDay(clock.date);

  if (day > clock.date) return "UNAVAILABLE";
  if (day === clock.date && phase === "in_progress") return "DELAYED";
  if (day === lastCompleted) return "EOD";
  if (day < lastCompleted) return "STALE";
  // Today before the open, a non-trading day, or a date the calendar lists as a holiday.
  return "UNAVAILABLE";
}
