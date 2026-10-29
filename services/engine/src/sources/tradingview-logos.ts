// TradingView symbol-logo CDN (HAKA-74): one SVG per `logoid` captured by the market scan (tradingview.ts). Unofficial
// and TradingView-owned artwork: accepted for the internal experiment only (DATA-ENGINE.md §8 decision 6), so the
// source is registered only with ENGINE_TICKER_LOGOS_ENABLED and serves nothing when it is off.
import { defineSource, type SourceDefinition } from "../registry";
import { isLogoId } from "./tradingview";

// The sanitizer is shared with the app's /api/logos proxy, which re-checks what the engine sends.
export { MAX_LOGO_BYTES, sanitizeSvg, type SanitizeResult } from "@/server/schemas/ticker-logo";

export const TRADINGVIEW_LOGO_HOST = "s3-symbol-logo.tradingview.com";
export const TRADINGVIEW_LOGO_SOURCE_ID = "tradingview-logos";

export function tradingviewLogoSource(): SourceDefinition {
  // Fetched on demand (one request per uncached symbol), so a short spacing; one in flight keeps a cold page polite.
  return defineSource({
    id: TRADINGVIEW_LOGO_SOURCE_ID, host: TRADINGVIEW_LOGO_HOST, kind: "reference", policy: { minIntervalMs: 250, concurrency: 1 },
    description: "TradingView symbol-logo CDN: ticker SVGs by logoid, on demand (internal experiment only)",
  });
}

export function logoUrl(logoId: string): string {
  if (!isLogoId(logoId)) throw new Error("Invalid logo id");
  return `https://${TRADINGVIEW_LOGO_HOST}/${logoId}.svg`;
}
