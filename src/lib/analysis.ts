import type { StatusTone } from "@/components/feedback/status-badge";
import type { AnalysisPattern, StockAnalysis } from "@/lib/api/market";

/**
 * Labels derived from the analysis numbers by HAKAPRO itself (the provider's own labels are dropped
 * server-side). Thresholds are the conventional ones and are stated in the UI copy.
 */
export function rsiZone(rsi: number | null): "oversold" | "overbought" | "neutral" | null {
  if (rsi === null) return null;
  return rsi <= 30 ? "oversold" : rsi >= 70 ? "overbought" : "neutral";
}

export function position(value: number | null, reference: number | null): "above" | "below" | "at" | null {
  if (value === null || reference === null) return null;
  return value > reference ? "above" : value < reference ? "below" : "at";
}

export function macdDirection(histogram: number | null | undefined): "positive" | "negative" | "flat" | null {
  if (histogram === null || histogram === undefined) return null;
  return histogram > 0 ? "positive" : histogram < 0 ? "negative" : "flat";
}

/** Today's volume against its 20-session average. */
export function volumeLevel(ratio: number | null): "below" | "near" | "above" | null {
  if (ratio === null) return null;
  return ratio < 0.8 ? "below" : ratio > 1.2 ? "above" : "near";
}

export function toneStatus(tone: NonNullable<StockAnalysis["score"]>["tone"]): StatusTone {
  return tone === "positive" ? "positive" : tone === "negative" ? "negative" : tone === "mixed" ? "warning" : "neutral";
}

/** Message key and values for a historical pattern name (namespace `analysis.pattern`). */
export function patternMessage(pattern: AnalysisPattern["pattern"]): { key: string; values: Record<string, string | number> } {
  switch (pattern.key) {
    case "combination": return { key: "combination", values: { parts: pattern.parts.join("+") } };
    case "priceVsMa": return { key: `priceVsMa.${pattern.position}`, values: { period: pattern.period } };
    case "foreignStrong": return { key: `foreignStrong.${pattern.side}`, values: {} };
    case "rsiZone": return { key: `rsiZone.${pattern.zone}`, values: {} };
    default: return { key: pattern.key, values: {} };
  }
}
