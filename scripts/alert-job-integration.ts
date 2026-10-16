#!/usr/bin/env bun
/**
 * Optional end-to-end check of the scheduled alert job against a throwaway local PostgreSQL (Plane HAKA-49).
 * Not part of `bun run verify`.
 *
 *   docker run -d --rm --name hakapro-alertjob-pg -e POSTGRES_PASSWORD=<random> -p 127.0.0.1:55432:5432 postgres:17-alpine
 *   DATABASE_URL=postgresql://postgres:<random>@127.0.0.1:55432/postgres bun run db:migrate
 *   ALERT_JOB_IT_DATABASE_URL=<same url> bun --conditions=react-server scripts/alert-job-integration.ts
 *   docker stop hakapro-alertjob-pg
 *
 * Uses its own variable (never DATABASE_URL, which Bun may load from .env.local) and refuses any host other
 * than loopback. Market data is the frozen baseline fixture (BBCA, session 2026-09-18); nothing calls a provider.
 * Seeds two fixed users (deleted first, cascading their alerts, events and notifications), then runs the job
 * with the same PostgreSQL store as the route and asserts counts. Prints counts only, never the URL.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { ArjumSource } from "../src/server/market/arjum-source";
import { BASELINE_DIR, createFixtureFetcher, FixtureSource } from "../src/server/market/fixture-source";
import { classifyDailyHistory, runAlertJob, type AlertJobResult } from "../src/server/services/alert-job";
import { postgresAlertJobStore } from "../src/server/services/alert-job-store";

const url = process.env.ALERT_JOB_IT_DATABASE_URL;
if (!url) throw new Error("ALERT_JOB_IT_DATABASE_URL is required (a throwaway local database)");
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("ALERT_JOB_IT_DATABASE_URL must point at loopback");

const users = { a: "00000000-0000-4000-8000-0000000000a1", b: "00000000-0000-4000-8000-0000000000a2" };
const alertId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// BBCA 2026-09-18: close 6300, change -0.79 (percent units), foreign net -56,761,900, volume 176,753,700, 20D ratio ≈ 1.4635.
const fixtureAlerts = [
  { n: 1, user: users.a, symbol: "BBCA", metric: "PRICE", operator: "LT", threshold: "6400", fires: true },
  { n: 2, user: users.a, symbol: "BBCA", metric: "PRICE", operator: "GTE", threshold: "6300", fires: true },
  { n: 3, user: users.a, symbol: "BBCA", metric: "PRICE", operator: "GT", threshold: "6300", fires: false },
  { n: 4, user: users.a, symbol: "BBCA", metric: "DAILY_CHANGE", operator: "LT", threshold: "-0.5", fires: true },
  { n: 5, user: users.a, symbol: "BBCA", metric: "DAILY_CHANGE", operator: "LTE", threshold: "-0.79", fires: true },
  // A fraction-unit threshold (-0.79% written as -0.0079) does not match: thresholds are percent units.
  { n: 6, user: users.a, symbol: "BBCA", metric: "DAILY_CHANGE", operator: "GT", threshold: "-0.0079", fires: false },
  { n: 7, user: users.b, symbol: "BBCA", metric: "FOREIGN_NET", operator: "LT", threshold: "0", fires: true },
  { n: 8, user: users.b, symbol: "BBCA", metric: "FOREIGN_NET", operator: "GT", threshold: "0", fires: false },
  { n: 9, user: users.b, symbol: "BBCA", metric: "VOLUME", operator: "GT", threshold: "100000000", fires: true },
  { n: 10, user: users.b, symbol: "BBCA", metric: "VOLUME", operator: "LTE", threshold: "100000000", fires: false },
  { n: 11, user: users.b, symbol: "BBCA", metric: "VOLUME_RATIO_20D", operator: "GTE", threshold: "1.4", fires: true },
  { n: 12, user: users.b, symbol: "BBCA", metric: "VOLUME_RATIO_20D", operator: "GT", threshold: "1.5", fires: false },
  { n: 13, user: users.b, symbol: "BBCA", metric: "PRICE", operator: "GT", threshold: "0", fires: false, enabled: false },
  // No recording for TLKM: unavailable, never an error.
  { n: 14, user: users.b, symbol: "TLKM", metric: "PRICE", operator: "GT", threshold: "0", fires: false },
] as const;
const firing = fixtureAlerts.filter((alert) => alert.fires).map((alert) => alertId(alert.n)).sort();

const failures: string[] = [];
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(actual)}`);
  if (!ok) failures.push(`${label}: expected ${JSON.stringify(expected)}`);
}

const clients = [postgres(url, { max: 3, onnotice: () => {} }), postgres(url, { max: 3, onnotice: () => {} })];
const [sql] = clients;
const dbs = clients.map((client) => drizzle(client, { schema, casing: "snake_case" }));
const fixture = new FixtureSource(undefined, BASELINE_DIR);
// Recorded responses through the live ArjumSource code path (HISTORICAL series, reclassified by the job).
const recorded = new ArjumSource(createFixtureFetcher(BASELINE_DIR), "recorded:arjum");
const afterClose = new Date("2026-09-18T10:00:00Z"); // 17:00 WIB, after post-trading
const nextWeek = new Date("2026-09-22T10:00:00Z"); // newer sessions closed: 2026-09-18 is STALE

function job(db: (typeof dbs)[number], source: ArjumSource, now: Date): Promise<AlertJobResult> {
  return runAlertJob({
    ...postgresAlertJobStore(db),
    getHistory: async (symbol) => classifyDailyHistory(await source.history(symbol, { frame: "daily", limit: 30 }), now),
  });
}

async function counts() {
  const [row] = await sql`select
    (select count(*)::int from alert_events e join alerts a on a.id = e.alert_id where a.user_id in ${sql(Object.values(users))}) as events,
    (select count(*)::int from notifications where user_id in ${sql(Object.values(users))}) as notifications`;
  return { events: row.events as number, notifications: row.notifications as number };
}

try {
  await sql`delete from users where id in ${sql(Object.values(users))}`;
  await sql`insert into users ${sql([
    { id: users.a, name: "Alert IT A", email: "alert-it-a@example.invalid" },
    { id: users.b, name: "Alert IT B", email: "alert-it-b@example.invalid" },
  ])}`;
  await sql`insert into alerts ${sql(fixtureAlerts.map((alert) => ({ id: alertId(alert.n), user_id: alert.user, symbol: alert.symbol,
    metric: alert.metric, operator: alert.operator, threshold: alert.threshold, enabled: "enabled" in alert ? alert.enabled : true })))}`;
  // Only this script's alerts may be enabled, or the job's counts include foreign rows.
  const [{ others }] = await sql`select count(*)::int as others from alerts where enabled and user_id not in ${sql(Object.values(users))}`;
  if (others > 0) throw new Error("Database has other enabled alerts; use an empty throwaway database");

  check("fixture source (never current)", await job(dbs[0], fixture, afterClose), { evaluated: 0, triggered: 0, unavailable: 13, failed: 0 });
  check("rows after fixture run", await counts(), { events: 0, notifications: 0 });

  const concurrent = await Promise.all(dbs.map((db) => job(db, recorded, afterClose)));
  check("concurrent first runs, evaluated each", concurrent.map((result) => result.evaluated), [12, 12]);
  check("concurrent first runs, triggered total", concurrent.reduce((sum, result) => sum + result.triggered, 0), firing.length);
  check("concurrent first runs, unavailable/failed", concurrent.map((result) => [result.unavailable, result.failed]), [[1, 0], [1, 0]]);
  check("rows after first runs", await counts(), { events: firing.length, notifications: firing.length });

  check("second run (idempotent)", await job(dbs[0], recorded, afterClose), { evaluated: 12, triggered: 0, unavailable: 1, failed: 0 });
  check("stale session run", await job(dbs[0], recorded, nextWeek), { evaluated: 0, triggered: 0, unavailable: 13, failed: 0 });
  check("rows after reruns", await counts(), { events: firing.length, notifications: firing.length });

  const events = await sql`select e.alert_id, e.observed_value::text as value, e.observed_as_of::text as as_of from alert_events e
    join alerts a on a.id = e.alert_id where a.user_id in ${sql(Object.values(users))} order by e.alert_id`;
  check("event alert ids", events.map((event) => event.alert_id), firing);
  check("event as-of", [...new Set(events.map((event) => event.as_of))], ["2026-09-18"]);
  check("event values", Object.fromEntries(events.map((event) => [Number(event.alert_id.slice(-12)), event.value])),
    { 1: "6300.000000", 2: "6300.000000", 4: "-0.790000", 5: "-0.790000", 7: "-56761900.000000", 9: "176753700.000000", 11: "1.463514" });
  const notifications = await sql`select n.entity_id, n.user_id, n.type, n.title, n.message, n.entity_type, count(*) over (partition by n.entity_id)::int as per_alert,
    a.user_id as owner from notifications n join alerts a on a.id = n.entity_id where n.user_id in ${sql(Object.values(users))} order by n.entity_id`;
  check("one notification per event", notifications.map((row) => row.per_alert).every((count) => count === 1) && notifications.length === events.length, true);
  check("notification owners match alert owners", notifications.every((row) => row.user_id === row.owner && row.entity_type === "alert"), true);
  check("notification types", notifications.map((row) => row.type),
    ["PRICE_ALERT", "PRICE_ALERT", "PRICE_ALERT", "PRICE_ALERT", "FOREIGN_FLOW_ALERT", "VOLUME_ALERT", "VOLUME_ALERT"]);
  check("notification sample", [notifications[0].title, notifications[0].message], ["BBCA PRICE alert", "Observed 6300.000000 as of 2026-09-18"]);
  const triggeredAlerts = await sql`select id from alerts where last_triggered_at is not null and user_id in ${sql(Object.values(users))} order by id`;
  check("last_triggered_at set on fired alerts only", triggeredAlerts.map((row) => row.id), firing);
} finally {
  await Promise.all(clients.map((client) => client.end()));
}

if (failures.length) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("alert job integration: all checks passed");
