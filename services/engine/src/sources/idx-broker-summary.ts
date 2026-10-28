// IDX /primary GetBrokerSummary is a market-wide date×broker aggregate, not a per-stock broker summary.
import { z } from "zod";
import type { IdxFetchResult, IdxJsonParams, IdxJsonTransport } from "./idx-primary";

export const IDX_BROKER_SUMMARY_PATH = "/TradingSummary/GetBrokerSummary" as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const maybeNumber = z.number().nullable().optional();
const rowSchema = z.object({
  Date: z.string().min(10), IDFirm: z.string().min(1), FirmName: z.string().nullable().optional(),
  Volume: maybeNumber, Value: maybeNumber, Frequency: maybeNumber,
}).loose();
const envelopeSchema = z.object({ recordsTotal: z.number().optional(), recordsFiltered: z.number().optional(), data: z.array(rowSchema) }).loose();

export type IdxBrokerDailyUpsert = {
  date: string; brokerCode: string; firmName: string | null; volume: number | null; value: number | null; frequency: number | null;
};
export type IdxBrokerReject = { brokerCode: string; reason: string };
export type IdxBrokerParse = { rows: IdxBrokerDailyUpsert[]; rejected: IdxBrokerReject[] };

const isRealDate = (value: string) => {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export function idxBrokerSummaryParams(date: string): IdxJsonParams {
  if (!isRealDate(date)) throw new Error("date must use a real YYYY-MM-DD date");
  return { date: date.replace(/-/g, ""), start: 0, length: 9999 };
}

export function parseIdxBrokerSummary(body: unknown, requestedDate: string): IdxBrokerParse {
  if (!isRealDate(requestedDate)) throw new Error("requestedDate must use a real YYYY-MM-DD date");
  const envelope = envelopeSchema.parse(body);
  const rows: IdxBrokerDailyUpsert[] = [];
  const rejected: IdxBrokerReject[] = [];
  const seen = new Set<string>();
  for (const raw of envelope.data) {
    const brokerCode = raw.IDFirm.trim().toUpperCase();
    const date = raw.Date.slice(0, 10);
    if (!ISO_DATE.test(date)) { rejected.push({ brokerCode, reason: "unparseable-date" }); continue; }
    if (date !== requestedDate) { rejected.push({ brokerCode, reason: "date-mismatch" }); continue; }
    if (!/^[A-Z0-9]{1,8}$/.test(brokerCode)) { rejected.push({ brokerCode, reason: "invalid-broker-code" }); continue; }
    if (seen.has(brokerCode)) { rejected.push({ brokerCode, reason: "duplicate-broker-code" }); continue; }
    const values = [raw.Volume, raw.Value, raw.Frequency];
    if (values.some((value) => value != null && value < 0)) { rejected.push({ brokerCode, reason: "negative-market-value" }); continue; }
    seen.add(brokerCode);
    rows.push({
      date, brokerCode, firmName: raw.FirmName?.trim() || null,
      volume: raw.Volume == null ? null : Math.round(raw.Volume), value: raw.Value == null ? null : Math.round(raw.Value),
      frequency: raw.Frequency == null ? null : Math.round(raw.Frequency),
    });
  }
  return { rows, rejected };
}

export function fetchIdxBrokerSummary(transport: IdxJsonTransport, date: string, signal?: AbortSignal): Promise<IdxFetchResult> {
  return transport.fetchJson(IDX_BROKER_SUMMARY_PATH, idxBrokerSummaryParams(date), signal);
}
