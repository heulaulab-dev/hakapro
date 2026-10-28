// IDX /primary GetStockSummary contract (reference: nichsedge/idx-bei, MIT).
// Date is YYYYMMDD; the response is a DataTables envelope containing one row per listed stock.
import { z } from "zod";
import type { DailyUpsert } from "../db/ingest";
import { round } from "../db/ingest";
import { IDX_ENDPOINT_PATHS, type IdxFetchResult, type IdxJsonTransport, type IdxJsonParams } from "./idx-primary";

export const IDX_STOCK_SUMMARY_PATH = "/TradingSummary/GetStockSummary" satisfies (typeof IDX_ENDPOINT_PATHS)[number];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const numish = z.number().nullable().optional();

const idxStockSummaryRowSchema = z.object({
  StockCode: z.string().min(1), Date: z.string().min(10), Close: z.number().nullable(),
  Previous: numish, OpenPrice: numish, High: numish, Low: numish, Volume: numish, Value: numish, Frequency: numish,
  ForeignBuy: numish, ForeignSell: numish,
}).loose();

export const idxStockSummaryEnvelopeSchema = z.object({
  recordsTotal: z.number().optional(), recordsFiltered: z.number().optional(), data: z.array(idxStockSummaryRowSchema),
}).loose();

export type IdxStockReject = { symbol: string; reason: string };
export type IdxStockParse = { rows: DailyUpsert[]; rejected: IdxStockReject[] };

function validIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Build one GetStockSummary request for the requested WIB trading date. */
export function idxStockSummaryParams(isoDate: string): IdxJsonParams {
  if (!validIsoDate(isoDate)) throw new Error("date must use a real YYYY-MM-DD date");
  return { date: isoDate.replace(/-/g, ""), start: 0, length: 9999 };
}

/** Normalize only complete, date-matched market rows; reject malformed market counts instead of storing them. */
export function parseIdxStockSummary(body: unknown, requestedDate: string): IdxStockParse {
  if (!validIsoDate(requestedDate)) throw new Error("requestedDate must use a real YYYY-MM-DD date");
  const envelope = idxStockSummaryEnvelopeSchema.parse(body);
  const rows: DailyUpsert[] = [];
  const rejected: IdxStockReject[] = [];
  for (const raw of envelope.data) {
    const symbol = raw.StockCode.trim().toUpperCase();
    const date = raw.Date.slice(0, 10);
    if (!ISO_DATE.test(date)) { rejected.push({ symbol, reason: "unparseable-date" }); continue; }
    if (date !== requestedDate) { rejected.push({ symbol, reason: "date-mismatch" }); continue; }
    if (!/^[A-Z0-9.-]{1,12}$/.test(symbol)) { rejected.push({ symbol, reason: "invalid-symbol" }); continue; }
    if (raw.Close === null || !(raw.Close > 0)) { rejected.push({ symbol, reason: "non-positive-close" }); continue; }
    const counts = [raw.Volume, raw.Value, raw.Frequency, raw.ForeignBuy, raw.ForeignSell];
    if (counts.some((value) => value != null && value < 0)) { rejected.push({ symbol, reason: "negative-market-value" }); continue; }
    rows.push({
      symbol, date, open: raw.OpenPrice ?? null, high: raw.High ?? null, low: raw.Low ?? null, close: round(raw.Close, 4),
      previousClose: raw.Previous ?? null,
      volume: raw.Volume == null ? null : Math.round(raw.Volume), value: raw.Value == null ? null : Math.round(raw.Value),
      frequency: raw.Frequency == null ? null : Math.round(raw.Frequency),
      foreignBuy: raw.ForeignBuy == null ? null : Math.round(raw.ForeignBuy), foreignSell: raw.ForeignSell == null ? null : Math.round(raw.ForeignSell),
    });
  }
  return { rows, rejected };
}

/** Fetch raw JSON for one date through the endpoint-restricted persistent IDX transport. */
export function fetchIdxStockSummary(transport: IdxJsonTransport, isoDate: string, signal?: AbortSignal): Promise<IdxFetchResult> {
  return transport.fetchJson(IDX_STOCK_SUMMARY_PATH, idxStockSummaryParams(isoDate), signal);
}
