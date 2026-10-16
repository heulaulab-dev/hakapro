import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Clock } from "../src/fetch/rate-limit";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

/** A recorded (trimmed) source response from test/fixtures/. */
export function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

/** Virtual clock: sleep advances time instantly and records each wait. */
export function fakeClock(start = 0): Clock & { sleeps: number[]; advance(ms: number): void } {
  let now = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => now,
    sleep: async (ms) => { sleeps.push(ms); now += ms; },
    advance: (ms) => { now += ms; },
  };
}

export async function tempDir(prefix = "engine-test-"): Promise<{ path: string; cleanup(): Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}

/** A WIB wall-clock instant, e.g. wib("2026-10-14", "16:30"). */
export const wib = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);
