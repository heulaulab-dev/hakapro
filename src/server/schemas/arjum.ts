// Ported from heulatrade lib/market/arjum/schemas.ts (Zod 3 → Zod 4).
// Shapes are derived from recorded provider responses in fixtures/arjum/*.json.
import { z } from "zod";

const finite = z.number();
const nullableFinite = finite.nullable();

export const searchItemSchema = z.object({
  stock_code: z.string(), stock_name: z.string(), last_date: z.string(),
  _nn: z.string(), _nc: z.string(), _init: z.string(),
});
export const searchResponseSchema = z.array(searchItemSchema);

export const screenerResponseSchema = z.object({
  date: z.string(), source: z.string(),
  rows: z.array(z.object({
    stock_code: z.string(), stock_name: z.string(), bucket: z.string(), summary: z.string(),
    wr_event: z.union([finite, z.string()]).nullable(),
    potential: z.union([finite, z.string()]).nullable(),
    drawdown: z.union([finite, z.string()]).nullable(),
    note: z.string(),
  })),
  raw: z.string(), cached_for_seconds: finite,
});

// Free text; parsed into structured fields by services/analysis-parse.ts and never shown verbatim (MIGRATION §9.5).
export const analysisResponseSchema = z.object({ stock_code: z.string(), output: z.string() });

const brokerBase = z.object({ broker_code: z.string(), broker_name: z.string() });
export const brokerSummaryResponseSchema = z.object({
  stock_code: z.string(),
  brokers: z.array(brokerBase.extend({
    bval: finite, bvol: finite, bfrq: finite,
    sval: finite, svol: finite, sfrq: finite,
    nval: finite, nvol: finite,
  })),
  // A side is null when fewer brokers traded on it (seen live for WOOD on 2026-10-02).
  // With `net=true` the level sides carry no frequency (seen live for BBCA on 2026-10-04).
  broker_levels: z.array(z.object({
    buy: brokerBase.extend({ bval: finite, bvol: finite, bfrq: finite.optional(), bavg: finite }).nullable(),
    sell: brokerBase.extend({ sval: finite, svol: finite, sfrq: finite.optional(), savg: finite }).nullable(),
  })),
  broker_start_date: z.string(), broker_end_date: z.string(), broker_date_min: z.string(), broker_date_max: z.string(),
  broker_net: z.boolean(), flow: z.string(),
});

export const brokerAccumulationResponseSchema = z.object({
  code: z.string(), start_date: z.string(), end_date: z.string(),
  series: z.array(brokerBase.extend({
    points: z.array(z.object({
      date: z.string(), nval: finite, nvol: finite, cum_nval: finite,
      bavg: nullableFinite, savg: nullableFinite,
    })),
  })),
  top_buyers: z.array(brokerBase.extend({ total_nval: finite })),
  top_sellers: z.array(brokerBase.extend({ total_nval: finite })),
});

export const historyResponseSchema = z.object({
  stock_code: z.string(), frame: z.string(),
  // Range the provider actually holds for the stock (newer responses only; absent in 2026-09 recordings).
  data_available: z.object({ start: z.string(), end: z.string() }).optional(),
  rows: z.array(z.object({
    date: z.string(), close: finite, change: finite, change_pct: finite,
    value: finite, volume: finite, freq: finite, f_buy: finite,
    f_sell: finite, n_foreign: finite, open: finite, high: finite,
    // Live data has null averages on some days (e.g. SAPX); never coerced to 0.
    low: finite, avg: nullableFinite,
  })),
});

const monthSummary = z.object({ avg: finite, up: finite, down: finite, total: finite, up_prob: finite });
export const seasonalityResponseSchema = z.object({
  stock_code: z.string(), years: z.array(z.string()),
  monthly_returns: z.record(z.string(), z.record(z.string(), finite)),
  summary: z.record(z.string(), monthSummary),
  yearly_avg: z.record(z.string(), finite),
});

export const marketCapResponseSchema = z.object({
  date: z.string(), total: finite, page: finite, per_page: finite, total_pages: finite,
  data: z.array(z.object({
    code: z.string(), name: z.string(), close: finite, listed_shares: finite,
    listed_shares_label: z.string(), market_cap: finite, market_cap_label: z.string(),
    turnover_ratio: finite, turnover_ratio_label: z.string(),
  })),
  // Only present when `codes` was requested: requested codes without data.
  not_found: z.array(z.string()).optional(),
});

export type FinancialNode = number | { [key: string]: FinancialNode };
export const financialNodeSchema: z.ZodType<FinancialNode> = z.lazy(() =>
  z.union([finite, z.record(z.string(), financialNodeSchema)]),
);
export const financialStatementsResponseSchema = z.object({
  stock_code: z.string(), report_type: z.string(), period: z.string(), count: finite,
  items: z.array(z.object({
    year: z.string(), quarter: z.string(), label: z.string(), fetched_at: z.string(),
    data: z.record(z.string(), financialNodeSchema),
  })),
});

export const insidersResponseSchema = z.object({
  stock_code: z.string(), count: finite, total: finite, page: finite, page_size: finite, total_pages: finite,
  items: z.array(z.object({
    name: z.string(), date: z.string(), action_type: z.string(), nationality: z.string(),
    previous_value: z.string(), previous_percentage: z.string(), current_value: z.string(),
    current_percentage: z.string(), changes_value: z.string(), changes_percentage: z.string(),
    price_formatted: z.string(), broker_code: z.string(), badges: z.array(z.string()),
  })),
});

export const doneDetailsResponseSchema = z.object({
  code: z.string(), date: z.string(), total: finite, page: finite, per_page: finite, total_pages: finite,
  data: z.array(z.object({
    time: z.string(), market_date: z.string(), market_board: z.string(), price: z.string(), price_num: finite,
    lot: z.string(), qty_num: finite, value_raw: finite, buyer: z.string(), seller: z.string(),
    buyer_type: z.string(), seller_type: z.string(), buy_order_number: z.string(), sell_order_number: z.string(),
    action: z.string(),
  })),
  elapsed_ms: finite,
});

export const healthResponseSchema = z.object({ ok: z.boolean(), status: z.string() });

/**
 * `/api/price/{code}`: today's running aggregate, not a realtime tick. Without a trade today,
 * `last_price` is the last close and `source_date` says which session it came from.
 */
export const priceResponseSchema = z.object({
  code: z.string(), last_price: finite, freq: finite, lot: finite, value: finite,
  source_date: z.string().optional(),
  data_ts: z.string().nullable(), served_ts: z.string(),
  market_state: z.string(), market_label: z.string(),
  no_trade_today: z.boolean(), quote_age_ms: nullableFinite,
});

export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type ScreenerResponse = z.infer<typeof screenerResponseSchema>;
export type BrokerSummaryResponse = z.infer<typeof brokerSummaryResponseSchema>;
export type BrokerAccumulationResponse = z.infer<typeof brokerAccumulationResponseSchema>;
export type HistoryResponse = z.infer<typeof historyResponseSchema>;
export type SeasonalityResponse = z.infer<typeof seasonalityResponseSchema>;
export type MarketCapResponse = z.infer<typeof marketCapResponseSchema>;
export type FinancialStatementsResponse = z.infer<typeof financialStatementsResponseSchema>;
export type InsidersResponse = z.infer<typeof insidersResponseSchema>;
export type DoneDetailsResponse = z.infer<typeof doneDetailsResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type PriceResponse = z.infer<typeof priceResponseSchema>;
export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;
