// Five-field cron (minute hour day-of-month month day-of-week), evaluated on the Asia/Jakarta wall clock.
// Supports `*`, lists, ranges and steps. Day-of-month and day-of-week are ANDed (simpler than Vixie's OR).
import { jakartaClock, type JakartaClock } from "@/lib/freshness/session";

type Field = { min: number; max: number };
const FIELDS: Field[] = [{ min: 0, max: 59 }, { min: 0, max: 23 }, { min: 1, max: 31 }, { min: 1, max: 12 }, { min: 0, max: 7 }];

export type CronSpec = { source: string; sets: Array<Set<number>> };

function parseField(text: string, { min, max }: Field): Set<number> {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step: ${part}`);
    let [lo, hi] = [min, max];
    if (range !== "*") {
      const [a, b] = range.split("-").map(Number);
      lo = a;
      hi = b === undefined ? (stepText === undefined ? a : max) : b;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) throw new Error(`Invalid cron field: ${part}`);
    for (let value = lo; value <= hi; value += step) values.add(value);
  }
  return values;
}

export function parseCron(source: string): CronSpec {
  const parts = source.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Cron spec needs 5 fields: ${source}`);
  const sets = parts.map((part, index) => parseField(part, FIELDS[index]));
  if (sets[4].has(7)) sets[4].add(0); // 7 = Sunday
  return { source, sets };
}

export type WibTime = JakartaClock & { month: number; day: number };

export function wibTime(now: Date): WibTime {
  const clock = jakartaClock(now);
  return { ...clock, month: Number(clock.date.slice(5, 7)), day: Number(clock.date.slice(8, 10)) };
}

export function cronMatches(spec: CronSpec, time: WibTime): boolean {
  const [minute, hour, day, month, weekday] = spec.sets;
  return minute.has(time.minutes % 60) && hour.has(Math.floor(time.minutes / 60)) && day.has(time.day) && month.has(time.month) && weekday.has(time.weekday);
}
