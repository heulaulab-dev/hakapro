// Session-window timing from the IDX calendar (src/server/config/idx-calendar.ts), incl. Friday sessions.
import { sessionsFor, toMinutes } from "@/server/config/idx-calendar";
import { isTradingDay } from "@/lib/freshness/session";
import type { WibTime } from "./cron";

/**
 * True when an every-N-minutes session job is due: on trading days only, at each session start, every N minutes
 * after it, and at the session end so each session's last state is captured. Lunch breaks never match.
 */
export function sessionPollDue(time: WibTime, everyMinutes: number): boolean {
  if (!isTradingDay(time.date)) return false;
  return sessionsFor(time.weekday).some((session) => {
    const start = toMinutes(session.start);
    const end = toMinutes(session.end);
    if (time.minutes < start || time.minutes > end) return false;
    return time.minutes === end || (time.minutes - start) % everyMinutes === 0;
  });
}

/** Whether the wall clock is inside any session window (inclusive), on a trading day. */
export function inSession(time: WibTime): boolean {
  return isTradingDay(time.date) && sessionsFor(time.weekday).some((s) => time.minutes >= toMinutes(s.start) && time.minutes <= toMinutes(s.end));
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Validates a daily `from`–`to` window (HH:MM WIB, `from` before `to`) and returns it in minutes. */
export function parseWindow(from: string, to: string): { start: number; end: number } {
  const [a, b] = [from.match(HHMM), to.match(HHMM)];
  if (!a || !b) throw new Error(`Invalid window ${from}–${to}`);
  const start = Number(a[1]) * 60 + Number(a[2]);
  const end = Number(b[1]) * 60 + Number(b[2]);
  if (start >= end) throw new Error(`Invalid window ${from}–${to}`);
  return { start, end };
}

/** True at `from`, every N minutes after it, and at `to`, on every calendar day (news does not follow the IDX calendar). */
export function windowPollDue(time: WibTime, window: { everyMinutes: number; from: string; to: string }): boolean {
  const { start, end } = parseWindow(window.from, window.to);
  if (time.minutes < start || time.minutes > end) return false;
  return time.minutes === end || (time.minutes - start) % window.everyMinutes === 0;
}
