"use server";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { alerts, alertEvents } from "@/db/schema";
import { ALERT_METRICS, ALERT_OPERATORS, validThreshold } from "@/lib/alerts";
import type { AlertInput, AlertRow, AlertEventRow } from "@/lib/user-data";
import { requireUser } from "@/server/auth";

const idSchema = z.uuid();
const alertFields = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,12}$/),
  metric: z.enum(ALERT_METRICS), operator: z.enum(ALERT_OPERATORS), threshold: z.number().finite(),
});
const alertSchema = alertFields.refine((alert) => validThreshold(alert.metric, alert.threshold), { message: "Invalid threshold", path: ["threshold"] });

export async function listAlerts(): Promise<AlertRow[]> {
  const user = await requireUser();
  const { db } = await import("@/server/db");
  const rows = await db.select({ id: alerts.id, symbol: alerts.symbol, metric: alerts.metric, operator: alerts.operator,
    threshold: alerts.threshold, enabled: alerts.enabled, lastTriggeredAt: alerts.lastTriggeredAt })
    .from(alerts).where(eq(alerts.userId, user.id)).orderBy(desc(alerts.createdAt), desc(alerts.id));
  return rows.map((row) => ({ ...alertFields.parse({ ...row, threshold: Number(row.threshold) }), id: row.id,
    enabled: row.enabled, last_triggered_at: row.lastTriggeredAt?.toISOString() ?? null }));
}

export async function listAlertEvents(): Promise<AlertEventRow[]> {
  const user = await requireUser();
  const { db } = await import("@/server/db");
  const rows = await db.select({ id: alertEvents.id, observedValue: alertEvents.observedValue,
    observedAsOf: alertEvents.observedAsOf, triggeredAt: alertEvents.triggeredAt,
    symbol: alerts.symbol, metric: alerts.metric, operator: alerts.operator, threshold: alerts.threshold })
    .from(alertEvents).innerJoin(alerts, eq(alerts.id, alertEvents.alertId))
    .where(eq(alerts.userId, user.id)).orderBy(desc(alertEvents.triggeredAt), desc(alertEvents.id)).limit(30);
  return rows.map((row) => ({ id: row.id, observed_value: Number(row.observedValue), observed_as_of: row.observedAsOf,
    triggered_at: row.triggeredAt.toISOString(), alert: alertFields.parse({ ...row, threshold: Number(row.threshold) }) }));
}

export async function createAlert(input: AlertInput): Promise<void> {
  const user = await requireUser();
  const alert = alertSchema.parse(input);
  const { db } = await import("@/server/db");
  await db.insert(alerts).values({ userId: user.id, ...alert, threshold: String(alert.threshold) });
}

export async function updateAlert(input: { id: string; enabled?: boolean; alert?: AlertInput }): Promise<void> {
  const user = await requireUser();
  const update = z.object({ id: idSchema, enabled: z.boolean().optional(), alert: alertSchema.optional() })
    .refine((value) => value.enabled !== undefined || value.alert !== undefined).parse(input);
  const { db } = await import("@/server/db");
  const changed = await db.update(alerts).set({ ...(update.enabled !== undefined ? { enabled: update.enabled } : {}),
    ...(update.alert ? { ...update.alert, threshold: String(update.alert.threshold) } : {}) })
    .where(and(eq(alerts.id, update.id), eq(alerts.userId, user.id))).returning({ id: alerts.id });
  if (!changed.length) throw new Error("NOT_FOUND");
}

export async function deleteAlert(alertId: string): Promise<void> {
  const user = await requireUser();
  const id = idSchema.parse(alertId);
  const { db } = await import("@/server/db");
  const deleted = await db.delete(alerts).where(and(eq(alerts.id, id), eq(alerts.userId, user.id))).returning({ id: alerts.id });
  if (!deleted.length) throw new Error("NOT_FOUND");
}
