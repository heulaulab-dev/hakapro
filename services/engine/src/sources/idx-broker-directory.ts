// IDX exchange-member directory. Separate from date×broker trading activity.
import { z } from "zod";
import type { IdxFetchResult, IdxJsonParams, IdxJsonTransport } from "./idx-primary";

export const IDX_BROKER_DIRECTORY_PATH = "/ExchangeMember/GetBrokerSearch" as const;
const envelope = z.object({
  recordsTotal: z.number().optional(),
  recordsFiltered: z.number().optional(),
  data: z.array(z.object({ Code: z.string(), Name: z.string(), License: z.string().nullable().optional() }).loose()),
}).loose();

export type IdxBrokerMember = { code: string; name: string; license: string | null };

export function idxBrokerDirectoryParams(): IdxJsonParams {
  return { option: 0, license: "", start: 0, length: 9999 };
}

export function parseIdxBrokerDirectory(body: unknown): { rows: IdxBrokerMember[]; complete: boolean; total: number | null; rejected: number } {
  const parsed = envelope.parse(body);
  const rows: IdxBrokerMember[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const record of parsed.data) {
    const code = record.Code.trim().toUpperCase();
    const name = record.Name.trim();
    if (!/^[A-Z0-9]{1,8}$/.test(code) || !name || seen.has(code)) { rejected += 1; continue; }
    seen.add(code);
    rows.push({ code, name: name.slice(0, 200), license: record.License?.trim().slice(0, 500) || null });
  }
  const total = parsed.recordsFiltered ?? parsed.recordsTotal ?? null;
  return { rows, rejected, total, complete: rows.length > 0 && total !== null && rows.length === parsed.data.length && rows.length === total };
}

export function fetchIdxBrokerDirectory(transport: IdxJsonTransport, signal?: AbortSignal): Promise<IdxFetchResult> {
  return transport.fetchJson(IDX_BROKER_DIRECTORY_PATH, idxBrokerDirectoryParams(), signal);
}
