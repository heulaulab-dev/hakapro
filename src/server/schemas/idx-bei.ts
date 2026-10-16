// Ported from heulatrade lib/market/contracts.ts + lib/market/providers/direct.ts (Zod 3 → Zod 4).
// Lane A: the existing Python market-api over idx-bei datasets (services/market-api/app.py).
import { z } from "zod";
import { stripIdentifiers } from "@/server/services/strip-identifiers";
import { symbolSchema } from "./inputs";

const num = z.number().nullable();

/** Envelope emitted by app.py `response()`: freshness is EOD | STALE | UNAVAILABLE. */
export const idxBeiMetaSchema = z.object({
  source: z.string(),
  fetchedAt: z.string(),
  dataAsOf: z.string().nullable(),
  freshness: z.string(),
});
export const idxBeiEnvelope = <T extends z.ZodType>(data: T) => z.object({ data, meta: idxBeiMetaSchema });

export const securitySchema = z.object({
  symbol: z.string(),
  companyName: z.string(),
  sector: z.string().nullable().optional(),
  subsector: z.string().nullable().optional(),
  board: z.string().nullable().optional(),
});

export const quoteSchema = z.object({
  symbol: symbolSchema,
  timestamp: z.string(),
  open: num, high: num, low: num, close: num,
  previousClose: num, change: num,
  /** Fraction, not percent (0.0111 = 1.11%). */
  changePercent: num,
  volume: num, value: num, frequency: num,
  foreignBuy: num, foreignSell: num,
});

export const candleSchema = z.object({
  time: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  open: num, high: num, low: num, close: z.number(),
  volume: num, foreignBuy: num, foreignSell: num,
});

export const stockSchema = z.object({ quote: quoteSchema, candles: z.array(candleSchema) });

export const marketOverviewSchema = z.object({
  indices: z.array(z.object({ code: z.string().nullable(), name: z.string().nullable(), close: num, previousClose: num, changePercent: num })),
  breadth: z.object({ advancers: z.number(), decliners: z.number(), unchanged: z.number(), value: z.number(), volume: z.number(), frequency: z.number() }),
  movers: z.array(z.object({ symbol: z.string().nullable(), name: z.string().nullable(), close: num, changePercent: num, volume: num, value: num, frequency: num })),
});

export const foreignSignalSchema = z.object({
  symbol: symbolSchema, close: num, sessions: z.number().int().nonnegative(),
  netForeignMillionShares: num, percentFloat: num, averageValueBillionIdr: num,
  signal: z.enum(["accumulate", "distribute"]),
});
export const signalsSchema = z.object({ tradingDate: z.string(), foreignFlow: z.array(foreignSignalSchema) });

/**
 * The Data Engine (E5) also sends, per period: each metric's unit (`IDR`, `USD`, `IDR/share`, `shares`), the filing
 * currency and the source (optional; app.py sent none). periodType is `ANNUAL` or `QUARTERLY` from the engine.
 */
export const fundamentalsSchema = z.array(z.object({
  periodDate: z.string().nullable(), periodType: z.string(), metrics: z.record(z.string(), num),
  units: z.record(z.string(), z.string()).optional(), currency: z.string().nullable().optional(), source: z.string().optional(),
}));
/**
 * IDX company-detail records (verified upstream keys: Direktur `Nama/Jabatan/Afiliasi`, Komisaris
 * `Nama/Jabatan/Independen`, PemegangSaham `Nama/Kategori/Jumlah/Persentase/Pengendali`). Tax and ID numbers
 * (NPWP, NPKP, ids) are stripped here, at the parsing boundary — they must never reach a response.
 */
const profileRecords = z.array(z.record(z.string(), z.unknown())).transform((records) => stripIdentifiers(records));
export const profileSchema = z.object({
  symbol: symbolSchema, companyName: z.string().nullable(), website: z.string().nullable(), description: z.string().nullable(),
  directors: profileRecords, commissioners: profileRecords, shareholders: profileRecords, subsidiaries: profileRecords,
}).strip();
export const actionsSchema = z.array(z.object({ date: z.string().nullable(), type: z.string().nullable(), description: z.string().nullable(), documentUrl: z.string().nullable() }));

// app.py /v1/news and /v1/announcements item shapes (the old BFF dropped these items — fixed here).
// The Data Engine (E3) also sends the outlet, matched IDX symbols and whether the date is the fetch time (optional).
export const newsItemSchema = z.object({
  date: z.string().nullable(), title: z.string().nullable(), summary: z.string().nullable(), url: z.string().nullable(),
  outlet: z.string().nullable().optional(), symbols: z.array(z.string()).optional(), dateEstimated: z.boolean().optional(),
});
export const announcementItemSchema = z.object({ date: z.string().nullable(), symbol: z.string().nullable(), title: z.string().nullable(), documentUrl: z.string().nullable() });

/** Data Engine `/v1/macro` (E3): Bank Indonesia series, observations newest first. BI-Rate in percent units. */
export const macroSeriesSchema = z.object({
  id: z.enum(["BI_RATE", "JISDOR"]), name: z.string(), unit: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), value: z.number(),
  previousDate: z.string().nullable(), previousValue: num, link: z.string().nullable(),
  observations: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), value: z.number() })),
});
export const macroSchema = z.object({ series: z.array(macroSeriesSchema) });

/** Data Engine `/v1/actions?from&to` (E3): market-wide corporate actions by ex-date, oldest first. */
export const actionsCalendarSchema = z.array(z.object({
  symbol: symbolSchema, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), type: z.string(), description: z.string().nullable(),
  amount: num, ratio: z.string().nullable(), documentUrl: z.string().nullable(),
}));

export const SCREEN_FIELDS = ["price", "volume", "value", "frequency", "foreignNetShares", "marketCap", "per", "pbv", "roe", "roa", "eps", "der", "dividendYield", "change1D"] as const;
export const screenFieldSchema = z.enum(SCREEN_FIELDS);
export const screenConditionSchema = z.object({
  field: screenFieldSchema,
  operator: z.enum(["GT", "GTE", "LT", "LTE", "EQ"]),
  value: z.number(),
  connective: z.enum(["AND", "OR"]).default("AND"),
});
export const screenRequestSchema = z.object({ conditions: z.array(screenConditionSchema).max(20), limit: z.number().int().min(1).max(1000).default(500) });
export const screenRowSchema = z.object({ symbol: symbolSchema, name: z.string().nullable() }).catchall(z.number().nullable());
/** Which source each returned ratio came from (Data Engine E5, optional): symbol → field → `derived` | `pasardana`. */
export const ratioSourcesSchema = z.record(z.string(), z.record(z.string(), z.enum(["derived", "pasardana"])));
export const screenResultSchema = z.object({
  rows: z.array(screenRowSchema), total: z.number().int().nonnegative(), supportedFields: z.array(screenFieldSchema),
  ratioSources: ratioSourcesSchema.optional(),
});

export type Security = z.infer<typeof securitySchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type Candle = z.infer<typeof candleSchema>;
export type Stock = z.infer<typeof stockSchema>;
export type MarketOverview = z.infer<typeof marketOverviewSchema>;
export type Signals = z.infer<typeof signalsSchema>;
export type Fundamentals = z.infer<typeof fundamentalsSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type CorporateActions = z.infer<typeof actionsSchema>;
export type NewsItem = z.infer<typeof newsItemSchema>;
export type AnnouncementItem = z.infer<typeof announcementItemSchema>;
export type Macro = z.infer<typeof macroSchema>;
export type ActionsCalendar = z.infer<typeof actionsCalendarSchema>;
export type ScreenRequest = z.infer<typeof screenRequestSchema>;
export type ScreenResult = z.infer<typeof screenResultSchema>;
