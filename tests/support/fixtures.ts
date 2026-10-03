import { readFileSync } from "node:fs";

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../fixtures/arjum/${name}.json`, import.meta.url), "utf8")) as T;
}

/** Builds a Date for a wall-clock time in Asia/Jakarta (UTC+7, no DST). */
export function wib(isoLocal: string): Date {
  return new Date(`${isoLocal}+07:00`);
}
