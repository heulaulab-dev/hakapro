import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { Database } from "@/lib/supabase/database.types";
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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "NOT_CONFIGURED" }, { status: 503 });
  const admin = createClient<Database>(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const source = getMarketDataSource();
  try {
    const result = await runAlertJob({
      fetchAlerts: async (offset, size) => {
        const { data, error } = await admin.from("alerts").select("id,symbol,metric,operator,threshold").eq("enabled", true).order("id").range(offset, offset + size - 1);
        if (error) throw error;
        return data ?? [];
      },
      getHistory: (symbol) => source.history(symbol, { frame: "daily", limit: 30 }),
      insertEvent: async ({ alertId, value, asOf }) => {
        const { data, error } = await admin.from("alert_events").upsert({ alert_id: alertId, observed_value: value, observed_as_of: asOf }, { onConflict: "alert_id,observed_as_of", ignoreDuplicates: true }).select("id");
        if (error) throw error;
        return Boolean(data?.length);
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
