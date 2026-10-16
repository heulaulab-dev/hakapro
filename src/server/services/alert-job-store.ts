import { asc, eq } from "drizzle-orm";
import { alerts, alertEvents } from "@/db/schema";
import type { Db } from "@/server/db";
import type { AlertJobDeps } from "./alert-job";

/**
 * PostgreSQL side of the alert job. Idempotency rests on the (alert_id, observed_as_of) unique constraint;
 * the alert_event_notification trigger sets last_triggered_at and adds one notification per new event.
 */
export function postgresAlertJobStore(db: Db): Pick<AlertJobDeps, "fetchAlerts" | "insertEvent"> {
  return {
    fetchAlerts: (offset, size) => db.select({ id: alerts.id, symbol: alerts.symbol,
      metric: alerts.metric, operator: alerts.operator, threshold: alerts.threshold })
      .from(alerts).where(eq(alerts.enabled, true)).orderBy(asc(alerts.id)).offset(offset).limit(size),
    insertEvent: async ({ alertId, value, asOf }) => {
      const inserted = await db.insert(alertEvents)
        .values({ alertId, observedValue: String(value), observedAsOf: asOf })
        .onConflictDoNothing({ target: [alertEvents.alertId, alertEvents.observedAsOf] })
        .returning({ id: alertEvents.id });
      return inserted.length > 0;
    },
  };
}
