import "server-only";
import { jakartaClock } from "@/lib/freshness";

/**
 * Per-user daily AI request limit — v1 is IN-MEMORY and PER PROCESS: it resets when the container restarts
 * and is not shared between instances. That is acceptable for one Coolify container; move it to PostgreSQL
 * (one row per user and Jakarta day) before running more than one instance.
 *
 * A request reserves a slot before calling the model and is charged only when it succeeds (`commit`); a
 * failed or rejected request releases its slot (`release`) and is never charged. Failures still count as
 * attempts, capped at ATTEMPT_MULTIPLIER × the limit, so a request that always fails cannot run up cost.
 */
export const ATTEMPT_MULTIPLIER = 3;
const MAX_USERS_PER_DAY = 10_000;

type Day = { used: number; pending: number; attempts: number };
const days = new Map<string, Map<string, Day>>();

export type QuotaSnapshot = { used: number; limit: number; remaining: number };
export type Reservation = QuotaSnapshot & { commit: () => QuotaSnapshot; release: () => QuotaSnapshot };
export type QuotaDecision = ({ ok: true } & Reservation) | ({ ok: false; reason: "QUOTA_EXCEEDED" | "ATTEMPTS_EXCEEDED" } & QuotaSnapshot);

function bucket(now: Date): Map<string, Day> {
  const day = jakartaClock(now).date;
  let users = days.get(day);
  if (!users) {
    days.clear(); // earlier days can never be charged again
    users = new Map();
    days.set(day, users);
  }
  return users;
}

const snapshot = (entry: Day, limit: number): QuotaSnapshot => ({ used: entry.used, limit, remaining: Math.max(0, limit - entry.used - entry.pending) });

export function reserveAiRequest(userKey: string, limit: number, now: Date = new Date()): QuotaDecision {
  const users = bucket(now);
  let entry = users.get(userKey);
  if (!entry) {
    if (users.size >= MAX_USERS_PER_DAY) users.delete(users.keys().next().value!);
    entry = { used: 0, pending: 0, attempts: 0 };
    users.set(userKey, entry);
  }
  if (entry.used + entry.pending >= limit) return { ok: false, reason: "QUOTA_EXCEEDED", ...snapshot(entry, limit) };
  if (entry.attempts >= limit * ATTEMPT_MULTIPLIER) return { ok: false, reason: "ATTEMPTS_EXCEEDED", ...snapshot(entry, limit) };
  const held = entry;
  held.pending += 1;
  held.attempts += 1;
  let settled = false;
  const settle = (charge: boolean) => {
    if (!settled) {
      settled = true;
      held.pending -= 1;
      if (charge) held.used += 1;
    }
    return snapshot(held, limit);
  };
  return { ok: true, ...snapshot(held, limit), commit: () => settle(true), release: () => settle(false) };
}

export function aiQuotaStatus(userKey: string, limit: number, now: Date = new Date()): QuotaSnapshot {
  return snapshot(bucket(now).get(userKey) ?? { used: 0, pending: 0, attempts: 0 }, limit);
}

export function clearAiQuota(): void {
  days.clear();
}
