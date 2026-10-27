// IDX /primary historical index adapter (reference: nichsedge/idx-bei `GetIndexSummary`, MIT).
//
// This module is the transport-INDEPENDENT half: request construction, response models, index-code normalization,
// and historical-observation validation. It never performs a network request itself. The actual bytes come from an
// injected `IdxIndexTransport` (see below): idx.co.id/primary sits behind a Cloudflare WAF that idx-bei defeats with
// TLS-fingerprint browser impersonation (`curl_cffi impersonate=chrome`, rotated on 403). That transport behaviour is
// deliberately NOT reproduced here; an operator must inject an authorized transport. With none injected, the adapter
// returns an explicit UNAVAILABLE result — it never fabricates index history.
//
// Endpoint (verified in idx-bei docs/API_VERIFICATION_SPEC.md, Aug 2026):
//   GET https://www.idx.co.id/primary/TradingSummary/GetIndexSummary?date=YYYYMMDD&start=0&length=9999
//   → DataTables envelope { draw, recordsTotal, recordsFiltered, data: [ { IndexCode, Date, OHLC, NumberOfStock, … } ] }
import { z } from "zod";
import type { IndexDailyUpsert } from "../db/ingest";
import { round } from "../db/ingest";
import { defineSource, type SourceDefinition } from "../registry";

export const IDX_PRIMARY_BASE_URL = "https://www.idx.co.id/primary";
export const IDX_PRIMARY_HOST = new URL(IDX_PRIMARY_BASE_URL).host; // www.idx.co.id
export const IDX_INDEX_SUMMARY_PATH = "/TradingSummary/GetIndexSummary";

/** Full request URL for a given base (base overridable so an authorized gateway can be configured). */
export const indexSummaryUrl = (base: string = IDX_PRIMARY_BASE_URL): string => `${base.replace(/\/+$/, "")}${IDX_INDEX_SUMMARY_PATH}`;

/** Query params for one WIB trading date. `isoDate` is `YYYY-MM-DD`; the endpoint wants `YYYYMMDD`. */
export function indexSummaryParams(isoDate: string): Record<string, string> {
  return { date: isoDate.replace(/-/g, ""), start: "0", length: "9999" };
}

// ── Response model ───────────────────────────────────────────────────────────────────────────────────────────────
const num = z.number().nullable();
const numish = num.optional();

/** One GetIndexSummary row. Field casing matches the verified GetStockSummary payload; unknown keys are ignored. */
export const idxIndexRowSchema = z.object({
  IndexCode: z.string().min(1),
  Date: z.string().min(1), // ISO datetime, e.g. "2026-08-07T00:00:00"
  Previous: numish, OpenPrice: numish, High: numish, Low: numish, Close: num, Change: numish,
  Volume: numish, Value: numish, Frequency: numish, NumberOfStock: numish,
}).loose();
export type IdxIndexRow = z.infer<typeof idxIndexRowSchema>;

export const idxIndexSummaryEnvelopeSchema = z.object({
  recordsTotal: z.number().optional(),
  recordsFiltered: z.number().optional(),
  data: z.array(idxIndexRowSchema),
}).loose();
export type IdxIndexSummaryEnvelope = z.infer<typeof idxIndexSummaryEnvelopeSchema>;

// ── Index-code normalization ─────────────────────────────────────────────────────────────────────────────────────
// IDX labels the composite "IHSG"; index_daily stores it as "COMPOSITE" (sources/yahoo IHSG_CODE). Sector/broad codes
// (LQ45, IDX30, IDXENERGY, …) are already canonical and pass through uppercased.
export const IDX_INDEX_CODE_ALIASES: Readonly<Record<string, string>> = { IHSG: "COMPOSITE", COMPOSITE: "COMPOSITE" };
export function normalizeIndexCode(raw: string): string {
  const up = raw.trim().toUpperCase();
  return IDX_INDEX_CODE_ALIASES[up] ?? up;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type IdxIndexReject = { code: string; reason: string };
export type IdxIndexParse = {
  /** index_daily-ready rows that passed validation. */
  rows: IndexDailyUpsert[];
  /** Rows dropped by validation, with why (historical-observation validation, never silently fabricated). */
  rejected: IdxIndexReject[];
};

/**
 * Validate + normalize a GetIndexSummary response into index_daily rows for `requestedIso`.
 * Rejects (never stores) rows with a non-positive/absent close or a trade date that does not match the requested day
 * — a mismatch means the WAF/transport returned a stale or wrong page, which must not be written as that day's data.
 */
export function parseIdxIndexSummary(body: unknown, requestedIso: string): IdxIndexParse {
  const envelope = idxIndexSummaryEnvelopeSchema.parse(body);
  const rows: IndexDailyUpsert[] = [];
  const rejected: IdxIndexReject[] = [];
  for (const raw of envelope.data) {
    const code = normalizeIndexCode(raw.IndexCode);
    const date = raw.Date.slice(0, 10);
    if (!ISO_DATE.test(date)) { rejected.push({ code, reason: "unparseable-date" }); continue; }
    if (date !== requestedIso) { rejected.push({ code, reason: "date-mismatch" }); continue; }
    if (raw.Close === null || !(raw.Close > 0)) { rejected.push({ code, reason: "non-positive-close" }); continue; }
    const previous = raw.Previous ?? null;
    const changePercent = previous && previous > 0 && raw.Change != null ? raw.Change / previous : null;
    rows.push({
      code, date, name: null,
      open: raw.OpenPrice ?? null, high: raw.High ?? null, low: raw.Low ?? null, close: round(raw.Close, 4),
      previousClose: previous, changePercent,
    });
  }
  return { rows, rejected };
}

// ── Transport (injectable; unavailable by default) ───────────────────────────────────────────────────────────────
export type IdxFetchResult =
  | { ok: true; body: unknown }
  | { ok: false; reason: string };

export type IdxIndexTransport = {
  id: string;
  /** Fetch raw GetIndexSummary JSON for one WIB trading date (ISO `YYYY-MM-DD`). */
  fetchIndexSummary(isoDate: string, signal?: AbortSignal): Promise<IdxFetchResult>;
};

export const IDX_TRANSPORT_UNAVAILABLE_REASON =
  "No authorized IDX /primary transport configured: idx.co.id is behind a Cloudflare WAF and IDX prohibits commercial "
  + "redistribution. Inject a licensed/authorized transport to enable historical sector backfill; refusing to fabricate.";

/** The default transport when none is configured: always reports UNAVAILABLE. */
export function unavailableIdxTransport(): IdxIndexTransport {
  return { id: "idx-primary-unconfigured", async fetchIndexSummary() { return { ok: false, reason: IDX_TRANSPORT_UNAVAILABLE_REASON }; } };
}

export const IDX_PRIMARY_SOURCE_ID = "idx-primary";

/** Source definition for health/provenance. One request in flight, 2 s apart, like the other polite price sources. */
export function idxPrimarySource(baseUrl: string = IDX_PRIMARY_BASE_URL): SourceDefinition {
  return defineSource({
    id: IDX_PRIMARY_SOURCE_ID, host: new URL(baseUrl).host, kind: "eod", policy: { minIntervalMs: 2000, concurrency: 1 },
    description: "IDX /primary GetIndexSummary: historical daily index values (authorized transport required)",
  });
}

/**
 * Build the index transport from config. Disabled → null (nothing registered). Enabled → an authorized transport must
 * be injected here; none ships in this build (WAF + licensing), so it returns the UNAVAILABLE transport, which makes
 * the backfill report unavailable rather than fabricate. `_baseUrl` is where an authorized transport would point.
 */
export function makeIdxIndexTransport(cfg: { enabled: boolean; baseUrl: string }): IdxIndexTransport | null {
  if (!cfg.enabled) return null;
  return unavailableIdxTransport();
}

export type IdxIndexSummaryResult =
  | { status: "OK"; parse: IdxIndexParse }
  | { status: "UNAVAILABLE"; reason: string };

/** Adapter entry point: fetch (via the injected transport) → validate/normalize, or an explicit UNAVAILABLE state. */
export async function collectIndexSummary(transport: IdxIndexTransport, isoDate: string, signal?: AbortSignal): Promise<IdxIndexSummaryResult> {
  const fetched = await transport.fetchIndexSummary(isoDate, signal);
  if (!fetched.ok) return { status: "UNAVAILABLE", reason: fetched.reason };
  return { status: "OK", parse: parseIdxIndexSummary(fetched.body, isoDate) };
}
