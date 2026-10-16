// TradingView public scanner (DATA-ENGINE.md §5.2/§5.3/§5.10): whole-market and index snapshots, 10 min delayed.
// Unofficial; internal experiment only (§8.6). One POST returns every IDX stock, so it backs the universe pass after
// the close and the session-window intraday polls.
import { z } from "zod";
import { symbolSchema } from "@/server/schemas/inputs";

export const TRADINGVIEW_ORIGIN = "https://scanner.tradingview.com";
export const TRADINGVIEW_HOST = "scanner.tradingview.com";
export const MARKET_SCAN_URL = `${TRADINGVIEW_ORIGIN}/indonesia/scan`;
export const INDEX_SCAN_URL = `${TRADINGVIEW_ORIGIN}/global/scan`;

/** Column order of the market scan; `d[i]` in each row follows it. */
export const MARKET_COLUMNS = ["name", "description", "sector", "close", "open", "high", "low", "change", "volume", "Value.Traded", "market_cap_basic", "update_mode"] as const;
export const INDEX_COLUMNS = ["name", "description", "close", "open", "high", "low", "change", "update_mode"] as const;
/** Index tickers confirmed on 2026-10-16 (others such as IDX80 or IDXTECHNO are not listed under these names). */
export const INDEX_TICKERS = ["COMPOSITE", "LQ45", "IDX30", "IDXENERGY", "IDXBASIC", "IDXINDUST", "IDXHEALTH", "IDXFINANCE", "IDXPROPERT"] as const;
/** Rows per market-scan page; one page covers the whole market (887 symbols on 2026-10-16). */
export const MARKET_PAGE_SIZE = 1000;

export function marketScanBody(from = 0, to = MARKET_PAGE_SIZE): string {
  return JSON.stringify({ columns: MARKET_COLUMNS, range: [from, to], sort: { sortBy: "Value.Traded", sortOrder: "desc" } });
}

export function indexScanBody(): string {
  return JSON.stringify({ symbols: { tickers: INDEX_TICKERS.map((code) => `IDX:${code}`) }, columns: INDEX_COLUMNS });
}

const responseSchema = z.object({
  totalCount: z.number().int().nonnegative(),
  data: z.array(z.object({ s: z.string(), d: z.array(z.unknown()) })),
});

const num = z.number().nullable();
const text = z.string().nullable();
const marketRowSchema = z.object({
  name: z.string(), description: text, sector: text, close: num, open: num, high: num, low: num, change: num,
  volume: num, "Value.Traded": num, market_cap_basic: num, update_mode: text,
});
const indexRowSchema = z.object({ name: z.string(), description: text, close: num, open: num, high: num, low: num, change: num, update_mode: text });

/** `delayed_streaming_600` → 600 s; `streaming` → 0; unknown → null. */
export function delaySecondsOf(updateMode: string | null): number | null {
  if (!updateMode) return null;
  const delayed = updateMode.match(/^delayed_streaming_(\d+)$/);
  if (delayed) return Number(delayed[1]);
  return updateMode === "streaming" ? 0 : null;
}

const fraction = (percent: number | null) => (percent === null ? null : percent / 100);

export type TvStockRow = {
  symbol: string; name: string | null; sector: string | null;
  close: number | null; open: number | null; high: number | null; low: number | null;
  /** Fraction of the previous close (TradingView sends percent). */
  changePercent: number | null;
  volume: number | null; value: number | null; marketCap: number | null; delaySeconds: number | null;
};

export type TvIndexRow = {
  code: string; name: string | null; close: number | null; open: number | null; high: number | null; low: number | null;
  changePercent: number | null; delaySeconds: number | null;
};

function rows<T extends z.ZodType>(textBody: string, columns: readonly string[], schema: T) {
  const parsed = responseSchema.parse(JSON.parse(textBody));
  const out: Array<{ ticker: string; row: z.infer<T> }> = [];
  let skipped = 0;
  for (const item of parsed.data) {
    const candidate = item.d.length === columns.length ? schema.safeParse(Object.fromEntries(columns.map((column, i) => [column, item.d[i]]))) : null;
    if (candidate?.success) out.push({ ticker: item.s, row: candidate.data });
    else skipped += 1;
  }
  return { totalCount: parsed.totalCount, rows: out, skipped };
}

/** Parses an `indonesia/scan` page. Only plain IDX tickers survive (`IDX:BBCA`); others are counted as skipped. */
export function parseMarketScan(textBody: string): { totalCount: number; rows: TvStockRow[]; skipped: number } {
  const parsed = rows(textBody, MARKET_COLUMNS, marketRowSchema);
  const out: TvStockRow[] = [];
  let skipped = parsed.skipped;
  for (const { ticker, row } of parsed.rows) {
    const symbol = symbolSchema.safeParse(row.name);
    if (!ticker.startsWith("IDX:") || !symbol.success || symbol.data !== row.name) { skipped += 1; continue; }
    out.push({
      symbol: symbol.data, name: row.description, sector: row.sector, close: row.close, open: row.open, high: row.high, low: row.low,
      changePercent: fraction(row.change), volume: row.volume, value: row["Value.Traded"], marketCap: row.market_cap_basic,
      delaySeconds: delaySecondsOf(row.update_mode),
    });
  }
  return { totalCount: parsed.totalCount, rows: out, skipped };
}

export function parseIndexScan(textBody: string): TvIndexRow[] {
  return rows(textBody, INDEX_COLUMNS, indexRowSchema).rows
    .filter(({ ticker }) => ticker.startsWith("IDX:"))
    .map(({ row }) => ({
      code: row.name, name: row.description, close: row.close, open: row.open, high: row.high, low: row.low,
      changePercent: fraction(row.change), delaySeconds: delaySecondsOf(row.update_mode),
    }));
}

/**
 * Previous close implied by a last price and its change fraction. Stock prices are whole rupiah, so they round to
 * integers; index levels keep three decimals.
 */
export function impliedPreviousClose(last: number | null, changePercent: number | null, decimals = 0): number | null {
  if (last === null || changePercent === null || changePercent <= -1) return null;
  const factor = 10 ** decimals;
  return Math.round((last / (1 + changePercent)) * factor) / factor;
}
