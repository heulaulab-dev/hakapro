// IDX DigitalStatistic financial ratios. Period snapshots keep original units; screener values are normalized separately.
import { z } from "zod";
import type { IdxFetchResult, IdxJsonParams, IdxJsonTransport } from "./idx-primary";

export const IDX_RATIO_PATH = "/DigitalStatistic/GetApiDataPaginated" as const;
export type IdxPeriodType = "annual" | "quarterly";
export type IdxRatioRequest = { year: number; quarter: 1 | 2 | 3 | 4; periodType: IdxPeriodType; page: number; pageSize?: number };
const metricKeys = ["assets", "liabilities", "equity", "sales", "ebt", "profitPeriod", "profitAttrOwner", "eps", "bookValue", "per", "priceBV", "deRatio", "roa", "roe", "npm"] as const;
const rawRatioRow = z.object({ code: z.string().min(1), fsDate: z.string().min(1) }).loose();
const envelope = z.object({ data: z.array(rawRatioRow), totalRecords: z.number().optional(), recordsTotal: z.number().optional() }).loose();

export type IdxRatioPeriod = {
  symbol: string; fsDate: string; periodType: IdxPeriodType; fiscalYearEnd: string | null; sharia: string | null;
  audit: string | null; opinion: string | null; metrics: Record<string, number | null>;
};
export type IdxStockRatio = { ratio: "per" | "pbv" | "roe" | "roa" | "eps" | "der"; value: number | null; basis: string; inputs: Record<string, number | null> };

const realDate = (v: string) => { const d = new Date(`${v}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; };
function numeric(value: unknown): number | null | undefined {
  if (value == null || value === "") return null;
  const result = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(result) ? result : undefined;
}

export function idxRatioParams(request: IdxRatioRequest): IdxJsonParams {
  if (!Number.isInteger(request.year) || request.year < 2000 || request.year > 2100 || !Number.isInteger(request.page) || request.page < 1) throw new Error("invalid IDX ratio period/page");
  return { urlName: "LINK_FINANCIAL_DATA_RATIO", periodQuarter: request.quarter, periodYear: request.year, type: request.periodType === "annual" ? "yearly" : "quarterly", isPrint: "false", cumulative: "false", pageSize: request.pageSize ?? 100, pageNumber: request.page, orderBy: "", search: "" };
}

export function parseIdxRatioPage(body: unknown, request: Pick<IdxRatioRequest, "year" | "quarter" | "periodType">) {
  const parsed = envelope.parse(body);
  const rows: IdxRatioPeriod[] = [];
  const rejected: Array<{ symbol: string; reason: string }> = [];
  for (const raw of parsed.data) {
    const symbol = raw.code.trim().toUpperCase();
    const fsDate = raw.fsDate.slice(0, 10);
    if (!/^[A-Z0-9]{1,8}$/.test(symbol)) { rejected.push({ symbol, reason: "invalid-symbol" }); continue; }
    const quarterMonth = Number(fsDate.slice(5, 7));
    const quarterMatches = request.periodType === "annual" || quarterMonth === request.quarter * 3;
    if (!realDate(fsDate) || Number(fsDate.slice(0, 4)) !== request.year || !quarterMatches) { rejected.push({ symbol, reason: "invalid-period-date" }); continue; }
    const metrics: Record<string, number | null> = {};
    let invalid = false;
    for (const key of metricKeys) {
      if (!(key in raw)) continue;
      const value = numeric(raw[key]);
      if (value === undefined) { invalid = true; break; }
      metrics[key] = value;
    }
    if (invalid) { rejected.push({ symbol, reason: "invalid-metric" }); continue; }
    rows.push({
      symbol, fsDate, periodType: request.periodType,
      fiscalYearEnd: typeof raw.fiscalYearEnd === "string" ? raw.fiscalYearEnd : null,
      sharia: typeof raw.sharia === "string" ? raw.sharia : null,
      audit: typeof raw.audit === "string" ? raw.audit : null, opinion: typeof raw.opini === "string" ? raw.opini : null, metrics,
    });
  }
  return { rows, rejected, totalRecords: parsed.totalRecords ?? parsed.recordsTotal ?? null };
}

export function toIdxStockRatios(row: IdxRatioPeriod): IdxStockRatio[] {
  const mapping = [
    { ratio: "per", key: "per", scale: 1, positive: true }, { ratio: "pbv", key: "priceBV", scale: 1, positive: true },
    { ratio: "roe", key: "roe", scale: 0.01, positive: false }, { ratio: "roa", key: "roa", scale: 0.01, positive: false },
    { ratio: "eps", key: "eps", scale: 1, positive: false }, { ratio: "der", key: "deRatio", scale: 1, positive: false },
  ] as const;
  return mapping.flatMap(({ ratio, key, scale, positive }) => {
    if (!(key in row.metrics)) return [];
    const input = row.metrics[key];
    return [{ ratio, value: input === null || (positive && input <= 0) ? null : input * scale, basis: `idx:${key}:${row.periodType}:${row.fsDate}`, inputs: { [key]: input } }];
  });
}

export function fetchIdxRatioPage(transport: IdxJsonTransport, request: IdxRatioRequest, signal?: AbortSignal): Promise<IdxFetchResult> {
  return transport.fetchJson(IDX_RATIO_PATH, idxRatioParams(request), signal);
}
