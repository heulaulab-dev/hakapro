/** Pure helpers for the news feed and corporate-action agenda: day keys, grouping, countdowns, outlets. */

const DAY = /^\d{4}-\d{2}-\d{2}/;
const MS_DAY = 86_400_000;

/** Calendar day (YYYY-MM-DD) of a provider date or timestamp, or null. Timestamps keep the provider's own date. */
export function dayKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = DAY.exec(value.trim());
  return match ? match[0] : null;
}

/** Today's date in WIB (UTC+7), the exchange's calendar. */
export function todayWib(now: number = Date.now()): string {
  return new Date(now + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); positive when `to` is later. */
export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_DAY);
}

export type DayBucket<T> = { day: string | null; items: T[] };

/** Groups items by day; items without a date go last. `dir` sorts the days. */
export function groupByDay<T>(items: T[], getDate: (item: T) => string | null | undefined, dir: "asc" | "desc" = "desc"): DayBucket<T>[] {
  const map = new Map<string, T[]>();
  const undated: T[] = [];
  for (const item of items) {
    const key = dayKey(getDate(item));
    if (!key) { undated.push(item); continue; }
    const list = map.get(key);
    if (list) list.push(item); else map.set(key, [item]);
  }
  const days = [...map.keys()].sort();
  if (dir === "desc") days.reverse();
  const out: DayBucket<T>[] = days.map((day) => ({ day, items: map.get(day)! }));
  if (undated.length) out.push({ day: null, items: undated });
  return out;
}

export type DayLabel = { kind: "today" | "yesterday" | "tomorrow" | "date"; day: string };

/** Relative label for a day versus `today`: today / yesterday / tomorrow, otherwise a plain date. */
export function relativeDay(day: string, today: string): DayLabel {
  const diff = dayDiff(today, day);
  return { kind: diff === 0 ? "today" : diff === -1 ? "yesterday" : diff === 1 ? "tomorrow" : "date", day };
}

export type Countdown = { kind: "today" | "in" | "ago"; days: number };

/** Days until (or since) an ex-date. */
export function countdown(day: string, today: string): Countdown {
  const diff = dayDiff(today, day);
  return diff === 0 ? { kind: "today", days: 0 } : diff > 0 ? { kind: "in", days: diff } : { kind: "ago", days: -diff };
}

/** Monday-based week start (YYYY-MM-DD) of a day. */
export function weekStart(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - offset * MS_DAY).toISOString().slice(0, 10);
}

/** Whether a day falls in the same Monday-based week as `today`. */
export function isThisWeek(day: string, today: string): boolean {
  return weekStart(day) === weekStart(today);
}

/** The 7 days (YYYY-MM-DD) of the week containing `day`, Monday first. */
export function weekDays(day: string): string[] {
  const start = Date.parse(`${weekStart(day)}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => new Date(start + i * MS_DAY).toISOString().slice(0, 10));
}

/** Outlet host from an article URL without "www."; null for non-http links. */
export function outletHost(url: string | null | undefined): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try { return new URL(url).hostname.replace(/^www\./, "") || null; } catch { return null; }
}

/** Two-letter monogram for an outlet host ("kontan.co.id" becomes "KO"). */
export function monogram(host: string | null): string {
  if (!host) return "··";
  const letters = host.replace(/[^a-zA-Z]/g, "");
  return (letters.slice(0, 2) || "··").toUpperCase();
}

/** Weekday name of a calendar day ("Senin" / "Monday"); "short" gives "Sen" / "Mon". Empty string for an invalid day. */
export function formatWeekday(day: string, locale: "id" | "en", width: "long" | "short" = "long"): string {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", { weekday: width, timeZone: "UTC" }).format(date);
}

/** Age of a timestamp in minutes/hours/days, or null when it has no time of day, is in the future, or is unparseable. */
export function relativeAge(value: string | null | undefined, now: number = Date.now()): { unit: "minute" | "hour" | "day"; value: number } | null {
  if (!value || DAY.exec(value)?.[0] === value.trim()) return null;
  const instant = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.trim().replace(" ", "T")}+07:00`);
  if (Number.isNaN(instant) || instant > now + 60_000) return null;
  const minutes = Math.max(0, Math.round((now - instant) / 60_000));
  if (minutes < 60) return { unit: "minute", value: Math.max(1, minutes) };
  if (minutes < 1440) return { unit: "hour", value: Math.floor(minutes / 60) };
  return { unit: "day", value: Math.floor(minutes / 1440) };
}
