import type { ValueFormat } from "@/lib/format";

export const ALERT_METRICS = ["PRICE", "DAILY_CHANGE", "FOREIGN_NET", "VOLUME", "VOLUME_RATIO_20D"] as const;
export const ALERT_OPERATORS = ["GT", "GTE", "LT", "LTE"] as const;
export type AlertMetric = (typeof ALERT_METRICS)[number];
export type AlertOperator = (typeof ALERT_OPERATORS)[number];

/** Units match src/server/services/alerts.ts: IDR, percent units, shares, ratio. */
export const METRIC_FORMAT: Record<AlertMetric, ValueFormat> = {
  PRICE: "idr", DAILY_CHANGE: "percent", FOREIGN_NET: "netSharesCompact", VOLUME: "sharesCompact", VOLUME_RATIO_20D: "number",
};

export function validThreshold(metric: AlertMetric, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (metric === "PRICE" || metric === "VOLUME" || metric === "VOLUME_RATIO_20D") return value >= 0;
  return true;
}
