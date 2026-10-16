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
