// IDX issuance actions, news search, and announcement metadata. We store official links only; attachment bodies are never fetched.
import { z } from "zod";
import { canonicalUrl, titleKey, type NewsItemParsed } from "./news";
import { matchSymbols } from "./news";
import type { IdxJsonParams, IdxJsonTransport } from "./idx-primary";

export const IDX_ISSUED_HISTORY_PATH = "/ListingActivity/GetIssuedHistory" as const;
export const IDX_NEWS_SEARCH_PATH = "/NewsAnnouncement/GetNewsSearch" as const;
export const IDX_ALL_ANNOUNCEMENTS_PATH = "/NewsAnnouncement/GetAllAnnouncement" as const;
export const IDX_CA_TYPES = ["tanpaHmetd", "hmetd", "stockSplit", "reverseStock", "sahamBonus", "dividenSaham", "BuybackSaham", "PrivatePlacement", "ipo", "waran", "gabungUsaha", "kurangModal", "konversiSaham", "companyListing", "partialDelisting"] as const;
const ACTION_TYPE: Record<(typeof IDX_CA_TYPES)[number], string> = {
  tanpaHmetd: "NON_RIGHTS_ISSUE", hmetd: "RIGHTS_ISSUE", stockSplit: "SPLIT", reverseStock: "REVERSE_SPLIT", sahamBonus: "BONUS_SHARES",
  dividenSaham: "STOCK_DIVIDEND", BuybackSaham: "BUYBACK", PrivatePlacement: "PRIVATE_PLACEMENT", ipo: "IPO", waran: "WARRANT",
  gabungUsaha: "MERGER", kurangModal: "CAPITAL_REDUCTION", konversiSaham: "SHARE_CONVERSION", companyListing: "COMPANY_LISTING", partialDelisting: "PARTIAL_DELISTING",
};
const realDate = (date: string) => { const d = new Date(`${date}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date; };
const dateOnly = (value: string) => value.slice(0, 10);
const localWibDate = (value: string) => {
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}+07:00`;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
};

export type IdxActionRow = { symbol: string; type: string; sourceCategory: string; exDate: string; shares: number | null; sharesAfter: number | null; description: string };
export function idxActionParams(caType: string, start: number, length = 9999, dateFrom = "", dateTo = ""): IdxJsonParams {
  if (!IDX_CA_TYPES.includes(caType as (typeof IDX_CA_TYPES)[number]) || !Number.isInteger(start) || start < 0 || !Number.isInteger(length) || length < 1 || length > 9999) throw new Error("invalid IDX corporate action request");
  return { caType, dateFrom, dateTo, start, length };
}
const actionEnvelope = z.object({ recordsTotal: z.number().optional(), recordsFiltered: z.number().optional(), data: z.array(z.object({ KodeEmiten: z.string(), TanggalPencatatan: z.string(), JenisTindakan: z.string().optional(), JumlahSaham: z.number().nullable().optional(), JumlahSahamSetelahTindakan: z.number().nullable().optional() }).loose()) }).loose();
export function parseIdxActions(body: unknown, caType: string, start = 0) {
  if (!IDX_CA_TYPES.includes(caType as (typeof IDX_CA_TYPES)[number])) throw new Error("unsupported IDX corporate action category");
  const parsed = actionEnvelope.parse(body);
  const rows: IdxActionRow[] = [];
  for (const raw of parsed.data) {
    const symbol = raw.KodeEmiten.trim().toUpperCase();
    const exDate = dateOnly(raw.TanggalPencatatan);
    if (!/^[A-Z0-9]{1,8}$/.test(symbol) || !realDate(exDate)) continue;
    const shares = raw.JumlahSaham ?? null;
    const sharesAfter = raw.JumlahSahamSetelahTindakan ?? null;
    rows.push({ symbol, type: ACTION_TYPE[caType as (typeof IDX_CA_TYPES)[number]], sourceCategory: caType, exDate, shares, sharesAfter,
      description: shares === null && sharesAfter === null ? caType : `${caType}; shares=${shares ?? "unknown"}; after=${sharesAfter ?? "unknown"}` });
  }
  const total = parsed.recordsFiltered ?? parsed.recordsTotal;
  return { rows, complete: typeof total === "number" && start + parsed.data.length >= total && rows.length === parsed.data.length, total: total ?? null };
}

const newsEnvelope = z.object({ total: z.number().optional(), data: z.array(z.object({ Id: z.union([z.string(), z.number()]), PublishedDate: z.string(), Title: z.string(), Summary: z.string().nullable().optional(), Tags: z.string().nullable().optional(), Links: z.array(z.object({ Rel: z.string().optional(), Href: z.string() }).loose()).optional() }).loose()) }).loose();
export function idxNewsParams(page: number, pageSize = 100): IdxJsonParams {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error("invalid IDX news pagination");
  return { pageNumber: page, pageSize, locale: "id-id" };
}
export function parseIdxNews(body: unknown, fetchedAt: Date, knownSymbols: ReadonlySet<string>): NewsItemParsed[] {
  const parsed = newsEnvelope.parse(body);
  const rows: NewsItemParsed[] = [];
  const seen = new Set<string>();
  for (const item of parsed.data) {
    const link = item.Links?.find((entry) => entry.Rel === "self")?.Href ?? item.Links?.[0]?.Href;
    let url: string | null = null;
    try {
      const candidate = new URL(link ?? "", "https://www.idx.co.id");
      if (candidate.protocol === "https:" && candidate.hostname === "www.idx.co.id") url = canonicalUrl(candidate.toString());
    } catch { /* malformed source links are skipped */ }
    const title = item.Title.trim().slice(0, 500);
    const key = titleKey(title);
    const publishedAt = localWibDate(item.PublishedDate);
    if (!url || !key || !publishedAt || seen.has(url) || seen.has(key)) continue;
    seen.add(url); seen.add(key);
    const tags = (item.Tags ?? "").split(/[\s,;|]+/).map((tag) => tag.trim().toUpperCase()).filter((symbol) => /^[A-Z0-9]{1,8}$/.test(symbol) && knownSymbols.has(symbol));
    const summary = item.Summary?.trim() ?? "";
    const sameAsTitle = titleKey(summary) === key;
    rows.push({ url, title, titleKey: key, publishedAt, publishedAtEstimated: publishedAt.getTime() > fetchedAt.getTime() + 3_600_000,
      summary: !summary || sameAsTitle ? null : summary.slice(0, 280), outlet: "IDX", symbols: [...new Set([...tags, ...matchSymbols(`${title}\n${summary}`, knownSymbols)])] });
  }
  return rows;
}

export function idxNewsPageInfo(body: unknown) {
  const parsed = newsEnvelope.parse(body);
  return { rows: parsed.data.length, total: parsed.total ?? null };
}

const attachmentSchema = z.array(z.object({ FullSavePath: z.string().optional() }).loose()).default([]);
const announcementEnvelope = z.object({ ItemCount: z.number().optional(), PageCount: z.number().optional(), PageNumber: z.number().optional(), Items: z.array(z.object({ Id: z.string().min(1), PublishDate: z.string(), Code: z.string().nullable().optional(), Title: z.string(), Attachments: attachmentSchema }).loose()) }).loose();
export type IdxAnnouncementRow = { externalId: string; symbol: string | null; publishedAt: Date; title: string; category: string | null; documentUrl: string | null };
export function idxAnnouncementParams(page: number, pageSize = 100, dateFrom?: string, dateTo?: string): IdxJsonParams {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error("invalid IDX announcements pagination");
  return { keywords: "", pageNumber: page, pageSize, lang: "id", ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}) };
}
export function parseIdxAnnouncements(body: unknown): IdxAnnouncementRow[] {
  const parsed = announcementEnvelope.parse(body);
  return parsed.Items.flatMap((item) => {
    const publishedAt = localWibDate(item.PublishDate);
    if (!publishedAt) return [];
    let documentUrl: string | null = null;
    for (const attachment of item.Attachments) {
      try { const url = new URL(attachment.FullSavePath ?? ""); if (url.protocol === "https:" && url.hostname === "www.idx.co.id") { documentUrl = url.toString(); break; } } catch { /* keep searching for a valid official attachment */ }
    }
    const symbol = item.Code?.trim().toUpperCase() ?? "";
    return [{ externalId: item.Id, symbol: /^[A-Z0-9]{1,8}$/.test(symbol) ? symbol : null, publishedAt, title: item.Title.trim().slice(0, 500), category: null, documentUrl }];
  });
}

export function idxAnnouncementPageInfo(body: unknown) {
  const parsed = announcementEnvelope.parse(body);
  return { rows: parsed.Items.length, total: parsed.ItemCount ?? null, pages: parsed.PageCount ?? null, page: parsed.PageNumber ?? null };
}

export const fetchIdxActions = (transport: IdxJsonTransport, caType: string, start: number, signal?: AbortSignal, dateFrom = "", dateTo = "") => transport.fetchJson(IDX_ISSUED_HISTORY_PATH, idxActionParams(caType, start, 9999, dateFrom, dateTo), signal);
export const fetchIdxNews = (transport: IdxJsonTransport, page: number, signal?: AbortSignal) => transport.fetchJson(IDX_NEWS_SEARCH_PATH, idxNewsParams(page), signal);
export const fetchIdxAnnouncements = (transport: IdxJsonTransport, page: number, dateFrom?: string, dateTo?: string, signal?: AbortSignal) => transport.fetchJson(IDX_ALL_ANNOUNCEMENTS_PATH, idxAnnouncementParams(page, 100, dateFrom, dateTo), signal);
