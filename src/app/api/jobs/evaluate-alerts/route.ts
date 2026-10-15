import { timingSafeEqual } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { alerts, alertEvents } from "@/db/schema";
import { logError } from "@/server/log";
import { getMarketDataSource } from "@/server/market";
import { runAlertJob } from "@/server/services/alert-job";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  // ALERT_JOB_SECRET is the scheduler secret; CRON_SECRET remains accepted for manual callers.
  return [process.env.ALERT_JOB_SECRET, process.env.CRON_SECRET].some((secret) => {
    if (!secret) return false;
    const expected = Buffer.from(`Bearer ${secret}`);
    const actual = Buffer.from(header);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

async function handle(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "NOT_CONFIGURED" }, { status: 503 });
  try {
    // Database access is initialized only after the scheduler secret is accepted.
    const { db } = await import("@/server/db");
    const source = getMarketDataSource();
    const result = await runAlertJob({
      fetchAlerts: (offset, size) => db.select({ id: alerts.id, symbol: alerts.symbol,
        metric: alerts.metric, operator: alerts.operator, threshold: alerts.threshold })
        .from(alerts).where(eq(alerts.enabled, true)).orderBy(asc(alerts.id)).offset(offset).limit(size),
      getHistory: (symbol) => source.history(symbol, { frame: "daily", limit: 30 }),
      insertEvent: async ({ alertId, value, asOf }) => {
        const inserted = await db.insert(alertEvents)
          .values({ alertId, observedValue: String(value), observedAsOf: asOf })
          .onConflictDoNothing({ target: [alertEvents.alertId, alertEvents.observedAsOf] })
          .returning({ id: alertEvents.id });
        return inserted.length > 0;
      },
    });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    logError("alert_job_failed");
    return NextResponse.json({ error: "ALERT_QUERY_FAILED" }, { status: 502 });
  }
}

export const GET = handle;
export const POST = handle;
