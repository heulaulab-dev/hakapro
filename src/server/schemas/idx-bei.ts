// Ported from heulatrade lib/market/contracts.ts + lib/market/providers/direct.ts (Zod 3 → Zod 4).
// Lane A: the existing Python market-api over idx-bei datasets (services/market-api/app.py).
import { z } from "zod";
import { OWNERSHIP_CHANGE_FLAGS, OWNERSHIP_CHANGE_KINDS } from "@/lib/ownership/changes";
import { RADAR_COUNTER_KEYS, RADAR_SIGNAL_KEYS } from "@/lib/radar/rules";
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

/** Data Engine `/v1/sectors`: per-sector performance of the newest session (changes are fractions, value in IDR). */
export const sectorsSchema = z.array(z.object({
  sector: z.string(), stocks: z.number().int().nonnegative(),
  advancers: z.number().int().nonnegative(), decliners: z.number().int().nonnegative(), unchanged: z.number().int().nonnegative(),
  changePercent: z.number(), valueWeightedChangePercent: num, value: z.number(),
  leader: z.object({ symbol: z.string(), changePercent: num }), laggard: z.object({ symbol: z.string(), changePercent: num }),
}));

/** `/v1/heatmap?limit=`: how many of the most-traded stocks (by value) the heatmap covers. */
export const HEATMAP_LIMITS = [30, 50, 100] as const;
export const HEATMAP_DEFAULT_LIMIT = 100;
/** A limit from a query string ("30" → 30); anything else fails. */
export const heatmapLimitSchema = z.coerce.number().pipe(z.literal(HEATMAP_LIMITS));

/**
 * Data Engine `/v1/heatmap`: the most-traded stocks of the newest view (the same rows as `/v1/market`), by traded
 * value, with per-sector totals. Changes are fractions, value and close in IDR, volume in shares.
 * `sector` is null for a stock not yet in the stored universe: never an invented bucket.
 */
export const heatmapStockSchema = z.object({
  symbol: symbolSchema, name: z.string().nullable(), sector: z.string().nullable(),
  close: num, changePercent: num, value: num, volume: num,
  /**
   * ESTIMATE in IDR, not a reported figure: (foreign buy shares − foreign sell shares) × close. Foreign data covers
   * only the stocks the arjum budget reached, and only end-of-day rows (never an intraday snapshot); null otherwise.
   */
  netForeignValueEstimate: num,
});
export const heatmapSectorSchema = z.object({
  sector: z.string().nullable(), stocks: z.number().int().nonnegative(),
  advancers: z.number().int().nonnegative(), decliners: z.number().int().nonnegative(), unchanged: z.number().int().nonnegative(),
  /** Sum of the members' traded value (IDR). */
  value: z.number(),
  /** Mean change of the members with a change (fraction); null when none has one. */
  changePercent: num,
  /** Sum of the members' net foreign ESTIMATES (IDR); null when no member has foreign data. */
  netForeignValueEstimate: num,
});
export const heatmapSchema = z.object({
  limit: z.number().int().positive(),
  /** Most-traded first. */
  stocks: z.array(heatmapStockSchema),
  /** Largest traded value first; the null sector (if any) is listed like any other. */
  sectors: z.array(heatmapSectorSchema),
});

/** `/v1/groups?window=`: the session window a group view is measured over. */
export const GROUP_WINDOWS = ["1D", "5D", "20D"] as const;
export const groupWindowSchema = z.enum(GROUP_WINDOWS);
export type GroupWindow = z.infer<typeof groupWindowSchema>;
/** "sourced": a public source names the link; "unverified": the curator could not confirm it, shown as such. */
export const groupConfidenceSchema = z.enum(["sourced", "unverified"]);
/**
 * Which way price and the foreign estimate disagree, when they do: a group (or stock) whose price rose while foreign
 * investors were net sellers, or fell while they were net buyers. Null when they agree or either side is zero/unknown.
 */
export const groupDivergenceSchema = z.enum(["price_up_foreign_net_sell", "price_down_foreign_net_buy"]).nullable();
const groupMoverSchema = z.object({ symbol: symbolSchema, changePercent: z.number() }).nullable();
const count = z.number().int().nonnegative();

/**
 * Data Engine `/v1/groups`: curated conglomerate groups measured over a session window. Changes are fractions, values
 * IDR. `netValueEstimate` is Σ (foreign buy − foreign sell shares) × close per session: an estimate, not a reported
 * value, over `foreign.members` members whose every session in the window has foreign data.
 */
export const groupsSchema = z.object({
  window: z.object({
    id: groupWindowSchema, sessions: count, from: z.string().nullable(), to: z.string().nullable(),
    /** "intraday": the 1D view of a session newer than the stored EOD rows (DELAYED); it has no foreign data. */
    basis: z.enum(["daily", "intraday"]),
  }),
  catalog: z.object({ version: z.string(), reviewedAt: z.string() }),
  groups: z.array(z.object({
    id: z.string(), name: z.object({ id: z.string(), en: z.string() }), confidence: groupConfidenceSchema, note: z.string().nullable(),
    reviewedAt: z.string(), sources: z.array(z.object({ label: z.string(), url: z.url({ protocol: /^https$/ }) })),
    members: count, membersWithData: count,
    /** Listed in the catalog but not in the engine's securities table (renamed, delisted, or a curation error). */
    unknownSymbols: z.array(z.string()),
    /** In the securities table but no longer active. */
    inactiveSymbols: z.array(z.string()),
    /** Known and active, but without a price row in the window. */
    noDataSymbols: z.array(z.string()),
    advancers: count, decliners: count, unchanged: count,
    changePercent: num, valueWeightedChangePercent: num, value: z.number(),
    foreign: z.object({ netValueEstimate: num, members: count, partialMembers: count }),
    divergence: groupDivergenceSchema,
    best: groupMoverSchema, worst: groupMoverSchema,
    stocks: z.array(z.object({
      symbol: symbolSchema, name: z.string().nullable(), confidence: groupConfidenceSchema, note: z.string().nullable(),
      close: num, changePercent: num, value: num, sessions: count,
      /** A split or other price-adjusting action in the window: its change is left out of the group's figures. */
      corporateAction: z.boolean(),
      netForeignValueEstimate: num, foreignSessions: count, divergence: groupDivergenceSchema,
    })),
  })),
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
  // Open-ended series id: Bank Indonesia series are uppercase (BI_RATE, JISDOR); World Bank commodities are `wb.*`.
  id: z.string().min(1), name: z.string(), unit: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), value: z.number(),
  previousDate: z.string().nullable(), previousValue: num, link: z.string().nullable(),
  observations: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), value: z.number() })),
});
export const macroSchema = z.object({ series: z.array(macroSeriesSchema) });

/** Per-index ingestion quality/coverage flags (Data Engine `serve/index-quality`). Generic, not RRG-specific. */
export const INDEX_QUALITY_FLAGS = ["STALE", "NON_POSITIVE_CLOSE", "UNORDERED"] as const;

/** Data Engine `/v1/indices/history` (sector-rotation): daily close series per index code, oldest first. */
export const indicesHistorySchema = z.object({
  series: z.array(z.object({
    code: z.string(),
    name: z.string().nullable(),
    points: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), close: z.number() })),
  })),
  // Ingestion observability (Phase 8): what is actually stored per code, and any data-quality flags. Optional so
  // older stubs and the unavailable lane still validate; the live engine always includes it.
  coverage: z.array(z.object({
    code: z.string(),
    name: z.string().nullable(),
    count: z.number().int(),
    firstDate: z.string().nullable(),
    lastDate: z.string().nullable(),
    spanTradingDays: z.number().int(),
    missingSessions: z.number().int(),
    staleTradingDays: z.number().int(),
    flags: z.array(z.enum(INDEX_QUALITY_FLAGS)),
  })).optional(),
});
export type IndicesHistory = z.infer<typeof indicesHistorySchema>;
export type IndexCoverageReport = NonNullable<IndicesHistory["coverage"]>[number];

/** Market-wide IDX GetBrokerSummary rows, date×broker (not stock-specific broker flow). */
export const marketBrokerSummarySchema = z.object({
  dates: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), brokers: z.array(z.object({
    code: z.string(), name: z.string().nullable(), volume: num, value: num, frequency: num,
  })) })),
});
export type MarketBrokerSummary = z.infer<typeof marketBrokerSummarySchema>;

/** IDX exchange-member directory (`GetBrokerSearch`), separate from traded broker totals. */
export const brokerDirectorySchema = z.object({
  brokers: z.array(z.object({ code: z.string(), name: z.string(), license: z.string().nullable() })),
});
export type BrokerDirectory = z.infer<typeof brokerDirectorySchema>;

/** Data Engine `/v1/actions?from&to` (E3): market-wide corporate actions by ex-date, oldest first. */
export const actionsCalendarSchema = z.array(z.object({
  symbol: symbolSchema, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), type: z.string(), sourceCategory: z.string().nullable().optional(), description: z.string().nullable(),
  amount: num, ratio: z.string().nullable(), shares: num.optional(), sharesAfter: num.optional(), documentUrl: z.string().nullable(),
}));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/**
 * Data Engine `/v1/insiders/recent?days&action&limit`: market-wide insider transactions dated within the last `days`
 * (from `from` to `to`, WIB), newest first, from a rotating per-symbol crawl (arjum). `coverage` states how much of the
 * market that crawl has read: `checked` of `active` symbols within the last `revisitDays` days, the oldest such read
 * on `oldestCheck`. Shares are signed (+ buy, − sell); percents in percent units (0.0061 = 0.0061%); price and value
 * (|shares| × price) in IDR, null when the source gives no price. Empty form (UNAVAILABLE) before the first read.
 */
export const insidersRecentSchema = z.object({
  days: z.number().int().positive(), from: isoDate, to: isoDate, action: z.enum(["buy", "sell", "cross"]).nullable(),
  coverage: z.object({
    checked: z.number().int().nonnegative(), active: z.number().int().nonnegative(), revisitDays: z.number().int().positive(), oldestCheck: isoDate.nullable(),
  }),
  transactions: z.array(z.object({
    symbol: symbolSchema, person: z.string(), roles: z.array(z.string()), action: z.enum(["BUY", "SELL", "CROSS", "OTHER"]), date: isoDate,
    sharesChange: num, sharesBefore: num, sharesAfter: num, percentBefore: num, percentAfter: num, percentChange: num,
    price: num, value: num, broker: z.string().nullable(), nationality: z.string().nullable(), source: z.string(), asOf: z.string(),
  })),
});

/**
 * Data Engine `/v1/radar`: per stock of the newest EOD session, the documented signals that fired (observed value,
 * threshold and window), the observations that point the other way, and whether each signal had the data it needs.
 * No composite score (spec §3.5): stocks are ordered by how many signals fired, then by traded value. Changes and
 * `fraction` signal values are fractions; `ratio` values are multiples; `count` values are whole numbers.
 */
const radarSignalKey = z.enum(RADAR_SIGNAL_KEYS);
const radarWindow = z.string().regex(/^(\d{1,3}D|\d{4}-\d{2})$/);
export const radarFiredSignalSchema = z.object({
  key: radarSignalKey,
  observed: z.number(),
  threshold: z.number(),
  /** "5D" (sessions ending at the trading date) or "2026-09" (the KSEI month). */
  window: radarWindow,
  /** Supporting figures (e.g. net foreign shares behind a share-of-volume value). */
  detail: z.record(z.string(), num),
});
export const radarCounterSchema = z.object({
  key: z.enum(RADAR_COUNTER_KEYS),
  window: radarWindow,
  values: z.record(z.string(), num),
});
export const RADAR_DATA_STATUSES = ["ok", "missing"] as const;
export const radarStockSchema = z.object({
  symbol: symbolSchema, name: z.string().nullable(), sector: z.string().nullable(),
  close: z.number(), changePercent: num, value: num,
  fired: z.array(radarFiredSignalSchema),
  counter: z.array(radarCounterSchema),
  firedCount: z.number().int().nonnegative(),
  status: z.record(radarSignalKey, z.enum(RADAR_DATA_STATUSES)),
});
export const radarRuleSchema = z.object({
  window: z.number().int().positive().nullable(), baseline: z.number().int().positive().nullable(),
  threshold: z.number(), unit: z.enum(["fraction", "ratio", "count"]),
});
export const radarSchema = z.object({
  tradingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  rulesVersion: z.string(),
  rules: z.record(radarSignalKey, radarRuleSchema),
  /** Newest uploaded KSEI month the ownership signal read; null before any upload. */
  kseiMonth: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  coverage: z.object({
    /** Stocks with a row in the newest session (all evaluated). */
    stocks: z.number().int().nonnegative(),
    /** Stocks with at least one firing signal, and how many of them are in `stocks` below (the list is capped). */
    listed: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    /** Per signal: stocks that had the data to evaluate it. */
    signals: z.record(radarSignalKey, z.number().int().nonnegative()),
  }),
  stocks: z.array(radarStockSchema),
});

/**
 * Data Engine `/v1/ownership/stealth`: in the newest uploaded KSEI month, stocks whose corporate (CP) ≥1% holders
 * raised their combined shares while the close was flat or lower between the two position dates. Share counts are
 * integer strings, percentages six-decimal strings (as /v1/ownership/changes); the price change is a fraction.
 */
const signedShareString = z.string().regex(/^-?\d{1,25}$/);
export const stealthHolderSchema = z.object({
  holderKey: z.string(), holderName: z.string(), investorType: z.string(), kind: z.enum(OWNERSHIP_CHANGE_KINDS),
  sharesBefore: z.string().nullable(), sharesAfter: z.string().nullable(), shareDelta: signedShareString.nullable(),
  percentBefore: z.string().nullable(), percentAfter: z.string().nullable(), ppDelta: z.string().nullable(),
  flags: z.array(z.enum(OWNERSHIP_CHANGE_FLAGS)),
});
const closeAt = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), close: z.number() });
export const stealthStockSchema = z.object({
  symbol: symbolSchema, name: z.string().nullable(), fromDate: z.string(), toDate: z.string(),
  /** Sum of the known share deltas of corporate holders present in both months. */
  combinedShareDelta: signedShareString,
  /** Corporate holders newly listed at ≥1% (earlier holding unknown, not summed). */
  newHolders: z.number().int().nonnegative(),
  holders: z.array(stealthHolderSchema),
  /** Close on or before each position date; null when either close is not stored (never treated as flat). */
  price: z.object({ from: closeAt, to: closeAt, changePercent: z.number() }).nullable(),
});
export const stealthOwnershipSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  previousMonth: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  rulesVersion: z.string(),
  rules: z.object({ investorTypes: z.array(z.string()), maxPriceChange: z.number(), maxCloseGapDays: z.number().int().nonnegative() }),
  coverage: z.object({
    /** Issuers in the month's list. */
    issuers: z.number().int().nonnegative(),
    /** Issuers where corporate holders raised their combined shares. */
    corporateIncrease: z.number().int().nonnegative(),
    /** Of those, excluded because the close rose more than the rule allows. */
    priceRose: z.number().int().nonnegative(),
    /** Of those, listed without a price change because a close is not stored. */
    priceMissing: z.number().int().nonnegative(),
  }),
  stocks: z.array(stealthStockSchema),
});

export const SCREEN_FIELDS = ["price", "volume", "value", "frequency", "foreignNetShares", "foreignNetValue", "relativeVolume", "pctFromHigh", "marketCap", "per", "pbv", "roe", "roa", "eps", "der", "dividendYield", "change1D"] as const;
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
export const ratioSourcesSchema = z.record(z.string(), z.record(z.string(), z.enum(["derived", "idx", "pasardana"])));
export const screenResultSchema = z.object({
  rows: z.array(screenRowSchema), total: z.number().int().nonnegative(), supportedFields: z.array(screenFieldSchema),
  ratioSources: ratioSourcesSchema.optional(),
});

export type Security = z.infer<typeof securitySchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type Candle = z.infer<typeof candleSchema>;
export type Stock = z.infer<typeof stockSchema>;
export type MarketOverview = z.infer<typeof marketOverviewSchema>;
export type HeatmapLimit = (typeof HEATMAP_LIMITS)[number];
export type HeatmapPayload = z.infer<typeof heatmapSchema>;
export type Signals = z.infer<typeof signalsSchema>;
export type Fundamentals = z.infer<typeof fundamentalsSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type CorporateActions = z.infer<typeof actionsSchema>;
export type NewsItem = z.infer<typeof newsItemSchema>;
export type AnnouncementItem = z.infer<typeof announcementItemSchema>;
export type Macro = z.infer<typeof macroSchema>;
export type ActionsCalendar = z.infer<typeof actionsCalendarSchema>;
export type InsidersRecent = z.infer<typeof insidersRecentSchema>;
export type ScreenRequest = z.infer<typeof screenRequestSchema>;
export type ScreenResult = z.infer<typeof screenResultSchema>;
export type Radar = z.infer<typeof radarSchema>;
export type StealthOwnership = z.infer<typeof stealthOwnershipSchema>;
