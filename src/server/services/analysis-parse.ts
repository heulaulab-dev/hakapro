/**
 * Turns arjum's `/api/analysis/{code}` free text into structured numbers and enums.
 *
 * Decision 2026-10-04 (MIGRATION §9.5, revised): HAKAPRO shows the analysis, labelled "Analysis",
 * but never the provider's wording. Only numbers and recognized categories leave this module; the
 * UI words them itself. Provider labels that can be derived from numbers (RSI zone, MACD trend,
 * position vs SMA, volume-ratio label) are dropped here and recomputed by the UI. Advice prose
 * ("Jika sudah punya…"), notes and the provider disclaimer are dropped. Lines that match no known
 * shape are reported as issues (logged by the caller), never passed through.
 *
 * Number conventions in this text (verified on BBCA 2026-09-18, ARCI/SAPX/DSSA/BBCA 2026-10-02):
 * Indonesian thousands dots without a suffix ("Rp1.240", "1.767.537 lot"); English scale letters with
 * a decimal dot ("Rp1109.37B", "177M lembar" = 177 million, "29K"); percents with a decimal dot.
 */
import type { AnalysisResponse } from "@/server/schemas/arjum";
import { parseIndonesianDate } from "./screener-date";
import { parseProviderNumber, type QuantityUnit } from "./parse-number";

export type Tone = "positive" | "negative" | "neutral" | "mixed";
export type Pivots = { r2: number | null; r1: number | null; p: number | null; s1: number | null; s2: number | null };

export type AnalysisFactor =
  | { key: "priceVsSma"; tone: Tone | null; position: "above" | "below"; period: number }
  | { key: "volume"; tone: Tone | null; level: "low" | "normal" | "high" }
  | { key: "foreign"; tone: Tone | null; side: "buy" | "sell" }
  | { key: "brokers"; tone: Tone | null; side: "accumulation" | "distribution" }
  | { key: "rsiZone"; tone: Tone | null; zone: "oversold" | "overbought" }
  | { key: "other"; tone: Tone | null };

export type PatternPart = "broker" | "foreign" | "technical";
export type AnalysisPattern = {
  pattern:
    | { key: "combination"; parts: PatternPart[] }
    | { key: "priceVsMa"; position: "above" | "below"; period: number }
    | { key: "foreignStrong"; side: "buy" | "sell" }
    | { key: "rsiRebound" }
    | { key: "rsiZone"; zone: "oversold" | "overbought" }
    | { key: "brokerConcentratedAccumulation" }
    | { key: "volumeClimax" }
    | { key: "other" };
  quality: "historicalEdge" | "validSample" | "other";
  /** All percent fields are percent units (51.5 = 51.5%). */
  winRatePercent: number | null; averageReturnPercent: number | null; day3ReturnPercent: number | null;
  potentialPercent: number | null; drawdownPercent: number | null;
  takeProfitPercent: number | null; cutLossPercent: number | null; timeoutPercent: number | null;
  samples: number | null; profitFactor: number | null; averageExitDays: number | null;
};

export type AnalysisStance = "avoid" | "reduce" | "accumulate" | "watch" | "hold" | "wait" | "other";

export type StockAnalysis = {
  symbol: string;
  companyName: string | null;
  /** Session the analysis was computed for (YYYY-MM-DD). */
  date: string | null;
  price: {
    closeIdr: number | null; changeIdr: number | null; changePercent: number | null;
    previousCloseIdr: number | null; openIdr: number | null; highIdr: number | null; lowIdr: number | null;
    rangeIdr: number | null; rangePercent: number | null; pivots: Pivots;
  };
  technical: {
    sma: Array<{ period: number; valueIdr: number }>;
    rsi14: number | null;
    bollinger: { upperIdr: number; middleIdr: number; lowerIdr: number } | null;
    macd: { macd: number; signal: number; histogram: number } | null;
    atrIdr: number | null; atrPercent: number | null;
  };
  volume: {
    shares: number | null; lots: number | null; valueIdr: number | null; frequency: number | null;
    average20Shares: number | null; ratio: number | null; trend: "rising" | "falling" | "stable" | null;
  };
  foreign: {
    side: "buy" | "sell" | null; netShares: number | null; percentOfVolume: number | null;
    recent: { buyDays: number; sellDays: number; sessions: number; averageNetShares: number | null } | null;
  };
  brokers: {
    total: number | null;
    topBuyers: Array<{ code: string; netValueIdr: number }>;
    topSellers: Array<{ code: string; netValueIdr: number }>;
    heavyBuyers: string[]; heavySellers: string[];
    /** Brokers on the same side for most of the recent sessions, e.g. AK sold on 4 of 5. */
    consistency: Array<{ code: string; side: "buy" | "sell"; days: number; sessions: number }>;
    moreConsistent: number;
  };
  score: { value: number; max: number; tone: Tone | null } | null;
  factors: AnalysisFactor[];
  patterns: AnalysisPattern[];
  outlook: {
    stance: AnalysisStance;
    /** Modifiers on the stance: a small position, conditional on price action, backed by a historical edge. */
    small: boolean; conditional: boolean; historicalEdge: boolean;
    entry: { lowIdr: number; highIdr: number } | null;
    targets: Array<{ priceIdr: number; basis: "R1" | "R2" | "P" | "S1" | "S2" | "weeklyPivot" | null }>;
    stopLoss: { priceIdr: number; percent: number | null } | null;
  } | null;
};

export type AnalysisIssue = { type: "unparsed_line" | "unknown_section" | "unrecognized_value"; section: string; text: string };

const TONES: Record<string, Tone> = { "🟢": "positive", "✅": "positive", "🔴": "negative", "⚪": "neutral", "→": "neutral", "⚠️": "mixed", "🟡": "mixed" };

/** Number from a provider token: suffix letters are English scale with a decimal dot, otherwise Indonesian grouping. */
export function analysisNumber(raw: string | undefined, unit: QuantityUnit): number | null {
  if (raw === undefined) return null;
  const text = raw.replace(/\*/g, "").replace(/x$/i, "").trim();
  if (!text) return null;
  const core = text.replace(/^[+\-−]?\s*(?:rp)?\.?\s*[+\-−]?/i, "").replace(/\s*(?:lembar|lot|saham)$/i, "").replace(/%$/, "").trim();
  const suffixed = /[a-z]$/i.test(core);
  const separators = !suffixed && unit !== "percent" && /^\d{1,3}(?:\.\d{3})+$/.test(core) ? "id" : "en";
  const result = parseProviderNumber(text, { unit, separators, scale: "en" });
  return result.ok ? result.quantity.value : null;
}

const SECTION = /^\*\*\S+\s+([A-Z][A-Z &]+?)\*\*$/;
const KNOWN_SECTIONS = ["PRICE ACTION", "TEKNIKAL", "VOLUME", "FOREIGN FLOW", "BROKER NETFLOW", "SIGNAL", "PERSONALITY HISTORIS", "REKOMENDASI"] as const;
type SectionName = (typeof KNOWN_SECTIONS)[number];

/** Lines that are recognized and deliberately dropped (provider wording, advice, derived labels). */
const DROPPED: Record<SectionName, RegExp[]> = {
  "PRICE ACTION": [/^\*\*Support & Resistance:\*\*$/],
  TEKNIKAL: [/^Trend:/, /^Posisi:/],
  VOLUME: [],
  "FOREIGN FLOW": [],
  "BROKER NETFLOW": [],
  SIGNAL: [],
  "PERSONALITY HISTORIS": [/^Basis:/, /^💡/],
  REKOMENDASI: [/^Jika sudah punya:/i, /^Jika belum punya:/i],
};

function emptyAnalysis(symbol: string): StockAnalysis {
  return {
    symbol, companyName: null, date: null,
    price: { closeIdr: null, changeIdr: null, changePercent: null, previousCloseIdr: null, openIdr: null, highIdr: null, lowIdr: null, rangeIdr: null, rangePercent: null, pivots: { r2: null, r1: null, p: null, s1: null, s2: null } },
    technical: { sma: [], rsi14: null, bollinger: null, macd: null, atrIdr: null, atrPercent: null },
    volume: { shares: null, lots: null, valueIdr: null, frequency: null, average20Shares: null, ratio: null, trend: null },
    foreign: { side: null, netShares: null, percentOfVolume: null, recent: null },
    brokers: { total: null, topBuyers: [], topSellers: [], heavyBuyers: [], heavySellers: [], consistency: [], moreConsistent: 0 },
    score: null, factors: [], patterns: [], outlook: null,
  };
}

const codes = (text: string) => text.split(",").map((code) => code.trim()).filter((code) => /^[A-Z0-9]{2,4}$/.test(code));

function parseFactor(line: string): AnalysisFactor | null {
  const match = /^•\s*(\S+)\s+(.*)$/.exec(line);
  if (!match) return null;
  const tone = TONES[match[1]] ?? null;
  const text = match[2].trim();
  let found: RegExpExecArray | null;
  if ((found = /^di (atas|bawah) SMA(\d+)$/i.exec(text))) return { key: "priceVsSma", tone, position: found[1].toLowerCase() === "atas" ? "above" : "below", period: Number(found[2]) };
  if ((found = /^Volume (sepi|normal|ramai|tinggi|besar)$/i.exec(text))) {
    const word = found[1].toLowerCase();
    return { key: "volume", tone, level: word === "sepi" ? "low" : word === "normal" ? "normal" : "high" };
  }
  if ((found = /^Foreign (beli|jual)$/i.exec(text))) return { key: "foreign", tone, side: found[1].toLowerCase() === "beli" ? "buy" : "sell" };
  if ((found = /^Heavy broker (akumulasi|distribusi)$/i.exec(text))) return { key: "brokers", tone, side: found[1].toLowerCase() === "akumulasi" ? "accumulation" : "distribution" };
  if ((found = /^(Oversold|Overbought)$/i.exec(text))) return { key: "rsiZone", tone, zone: found[1].toLowerCase() as "oversold" | "overbought" };
  return { key: "other", tone };
}

const PARTS: Record<string, PatternPart> = { broker: "broker", asing: "foreign", teknikal: "technical" };
function parsePatternName(name: string): AnalysisPattern["pattern"] {
  let found: RegExpExecArray | null;
  if ((found = /^Gabungan \((.+)\)$/i.exec(name))) {
    const parts = found[1].split("+").map((part) => PARTS[part.trim().toLowerCase()]);
    if (parts.every(Boolean)) return { key: "combination", parts };
  }
  if ((found = /^harga di (atas|bawah) MA(\d+)$/i.exec(name))) return { key: "priceVsMa", position: found[1].toLowerCase() === "atas" ? "above" : "below", period: Number(found[2]) };
  if ((found = /^asing (beli|jual) kuat$/i.exec(name))) return { key: "foreignStrong", side: found[1].toLowerCase() === "beli" ? "buy" : "sell" };
  if (/^RSI area pantulan$/i.test(name)) return { key: "rsiRebound" };
  if ((found = /^RSI (oversold|overbought)$/i.exec(name))) return { key: "rsiZone", zone: found[1].toLowerCase() as "oversold" | "overbought" };
  if (/^top broker akumulasi pekat$/i.test(name)) return { key: "brokerConcentratedAccumulation" };
  if (/^volume klimaks/i.test(name)) return { key: "volumeClimax" };
  return { key: "other" };
}

/** Stance from the provider's headline. Order matters: "HINDARI" wins over anything else in the line. */
function parseStance(text: string): Pick<NonNullable<StockAnalysis["outlook"]>, "stance" | "small" | "conditional" | "historicalEdge"> {
  const upper = text.toUpperCase();
  const stance: AnalysisStance =
    /HINDARI|AVOID/.test(upper) ? "avoid"
      : /\bJUAL\b|\bSELL\b|KURANGI|CUT/.test(upper) ? "reduce"
        : /AKUMULASI|\bBELI\b|\bBUY\b/.test(upper) ? "accumulate"
          : /WATCH|PANTAU/.test(upper) ? "watch"
            : /TAHAN|HOLD/.test(upper) ? "hold"
              : /TUNGGU|WAIT/.test(upper) ? "wait"
                : "other";
  return { stance, small: /KECIL|SMALL/.test(upper), conditional: /KONDISIONAL|KONFIRMASI|CONDITIONAL/.test(upper), historicalEdge: /EDGE HISTORIS|HIST_EDGE/.test(upper) };
}

const TARGET_BASIS: Record<string, NonNullable<StockAnalysis["outlook"]>["targets"][number]["basis"]> = { R1: "R1", R2: "R2", P: "P", S1: "S1", S2: "S2", "W-P": "weeklyPivot" };

export function parseAnalysis(value: AnalysisResponse): { data: StockAnalysis; issues: AnalysisIssue[]; recognizedSections: number } {
  const data = emptyAnalysis(value.stock_code);
  const issues: AnalysisIssue[] = [];
  const lines = value.output.split("\n").map((line) => line.trim()).filter(Boolean);
  let section: SectionName | "HEADER" | null = "HEADER";
  let recognizedSections = 0;
  let pattern: AnalysisPattern | null = null;
  const idr = (raw: string | undefined) => analysisNumber(raw, "idr");
  const pct = (raw: string | undefined) => analysisNumber(raw, "percent");
  const count = (raw: string | undefined) => analysisNumber(raw, "count");
  const shares = (raw: string | undefined) => analysisNumber(raw, "shares");

  for (const line of lines) {
    if (line.startsWith("***")) continue; // provider disclaimer
    const header = SECTION.exec(line);
    if (header) {
      const name = header[1].trim();
      section = (KNOWN_SECTIONS as readonly string[]).includes(name) ? (name as SectionName) : null;
      if (section) recognizedSections += 1;
      else issues.push({ type: "unknown_section", section: name, text: line.slice(0, 80) });
      pattern = null;
      continue;
    }
    if (section === null) continue;
    if (section !== "HEADER" && DROPPED[section].some((pattern) => pattern.test(line))) continue;
    let m: RegExpExecArray | null;
    let handled = true;
    switch (section) {
      case "HEADER":
        if (!data.date && /Analisis/i.test(line)) data.date = parseIndonesianDate(line);
        else if ((m = /^_(.+)_$/.exec(line))) data.companyName = m[1].trim();
        else handled = false;
        break;
      case "PRICE ACTION":
        if ((m = /\*\*(Rp[\d.,]+)\*\*\s*\(([^|]+)\|\s*([^)]+)\)/.exec(line))) {
          data.price.closeIdr = idr(m[1]); data.price.changeIdr = idr(m[2]); data.price.changePercent = pct(m[3]);
        } else if ((m = /^Prev:\s*(\S+)\s*\|\s*Open:\s*(\S+)$/.exec(line))) {
          data.price.previousCloseIdr = idr(m[1]); data.price.openIdr = idr(m[2]);
        } else if ((m = /^High:\s*(\S+)\s*\|\s*Low:\s*(\S+)$/.exec(line))) {
          data.price.highIdr = idr(m[1]); data.price.lowIdr = idr(m[2]);
        } else if ((m = /^Range:\s*(\S+)\s*\(([^)]+)\)$/.exec(line))) {
          data.price.rangeIdr = idr(m[1]); data.price.rangePercent = pct(m[2]);
        } else if ((m = /^Daily:\s*(.+)$/.exec(line))) {
          for (const part of m[1].split("|")) {
            const level = /^(R2|R1|P|S1|S2)\s+(\S+)$/.exec(part.trim());
            if (level) data.price.pivots[level[1].toLowerCase() as keyof Pivots] = idr(level[2]);
          }
        } else handled = false;
        break;
      case "TEKNIKAL":
        if (/^SMA\d+:/.test(line)) {
          for (const sma of line.matchAll(/SMA(\d+):\s*(Rp[\d.,]+)/g)) {
            const valueIdr = idr(sma[2]);
            if (valueIdr !== null) data.technical.sma.push({ period: Number(sma[1]), valueIdr });
          }
        } else if ((m = /^RSI\(14\):\s*\*\*([\d.]+)\*\*/.exec(line))) {
          data.technical.rsi14 = Number(m[1]);
        } else if ((m = /Upper\s+(\S+)\s*\|\s*Mid\s+(\S+)\s*\|\s*Lower\s+(\S+)/.exec(line))) {
          const [upperIdr, middleIdr, lowerIdr] = [idr(m[1]), idr(m[2]), idr(m[3])];
          data.technical.bollinger = upperIdr !== null && middleIdr !== null && lowerIdr !== null ? { upperIdr, middleIdr, lowerIdr } : null;
        } else if ((m = /^MACD\([^)]*\):\s*(\S+)\s*\|\s*Signal\s+(\S+)\s*\|\s*Hist\s+(\S+)$/.exec(line))) {
          const [macd, signal, histogram] = [idr(m[1]), idr(m[2]), idr(m[3])];
          data.technical.macd = macd !== null && signal !== null && histogram !== null ? { macd, signal, histogram } : null;
        } else if ((m = /^ATR\(14\):\s*(\S+)\s*\(([\d.]+)%/.exec(line))) {
          data.technical.atrIdr = idr(m[1]); data.technical.atrPercent = Number(m[2]);
        } else handled = false;
        break;
      case "VOLUME":
        if ((m = /^Volume:\s*\*\*(\S+)\*\*\s*lembar\s*\(([\d.]+)\s*lot\)$/.exec(line))) {
          data.volume.shares = shares(m[1]); data.volume.lots = analysisNumber(m[2], "lots");
        } else if ((m = /^Nilai:\s*(\S+)$/.exec(line))) {
          data.volume.valueIdr = idr(m[1]);
        } else if ((m = /^Freq:\s*(\S+)\s*transaksi$/.exec(line))) {
          data.volume.frequency = count(m[1]);
        } else if ((m = /^Rata2 20d:\s*(\S+)\s*\|\s*\*\*Ratio:\s*([\d.]+)x/.exec(line))) {
          data.volume.average20Shares = shares(m[1]); data.volume.ratio = Number(m[2]);
        } else if ((m = /^Trend:\s*(↑|↓|→)/.exec(line))) {
          data.volume.trend = m[1] === "↑" ? "rising" : m[1] === "↓" ? "falling" : "stable";
        } else handled = false;
        break;
      case "FOREIGN FLOW":
        if ((m = /^\*\*Net (Beli|Jual)\*\*\s*(\S+)\s*lembar\s*\(([\d.]+)% dari volume\)$/.exec(line))) {
          data.foreign.side = m[1] === "Beli" ? "buy" : "sell"; data.foreign.netShares = shares(m[2]); data.foreign.percentOfVolume = Number(m[3]);
        } else if ((m = /^5-hari:\s*\S*\s*Beli\s*(\d+)x\s*\/\s*Jual\s*(\d+)x\s*dari\s*(\d+)\s*hari\s*\|\s*Rata2\s*(\S+)\s*lembar$/.exec(line))) {
          data.foreign.recent = { buyDays: Number(m[1]), sellDays: Number(m[2]), sessions: Number(m[3]), averageNetShares: shares(m[4]) };
        } else handled = false;
        break;
      case "BROKER NETFLOW":
        if ((m = /^Total\s+(\d+)\s+broker/.exec(line))) {
          data.brokers.total = Number(m[1]); // a trailing "| Net: …" self-check is dropped
        } else if ((m = /^(Buyers|Sellers):\s*(.+)$/.exec(line))) {
          const rows = m[2].split(",").map((part) => /^([A-Z0-9]{2,4})\s+(\S+)$/.exec(part.trim())).flatMap((row) => {
            const netValueIdr = row ? idr(row[2]) : null;
            return row && netValueIdr !== null ? [{ code: row[1], netValueIdr }] : [];
          });
          if (m[1] === "Buyers") data.brokers.topBuyers = rows; else data.brokers.topSellers = rows;
        } else if (/^💡\s*Heavy (buyer|seller):/.test(line)) {
          const buyers = /Heavy buyer:\s*([A-Z0-9,]+)/.exec(line);
          const sellers = /Heavy seller:\s*([A-Z0-9,]+)/.exec(line);
          data.brokers.heavyBuyers = buyers ? codes(buyers[1]) : [];
          data.brokers.heavySellers = sellers ? codes(sellers[1]) : [];
        } else if ((m = /^📊\s*5-hari:\s*(.+)$/.exec(line))) {
          for (const part of m[1].split("|").map((item) => item.trim())) {
            const row = /^([A-Z0-9]{2,4})\s+(beli|jual)\s+(\d+)\/(\d+)$/.exec(part);
            const more = /^\+(\d+)$/.exec(part);
            if (row) data.brokers.consistency.push({ code: row[1], side: row[2] === "beli" ? "buy" : "sell", days: Number(row[3]), sessions: Number(row[4]) });
            else if (more) data.brokers.moreConsistent = Number(more[1]);
            else issues.push({ type: "unrecognized_value", section, text: part.slice(0, 80) });
          }
        } else handled = false;
        break;
      case "SIGNAL":
        if ((m = /^Score:\s*\*\*(\d+)\/(\d+)\*\*\s*—\s*(\S+)/.exec(line))) {
          data.score = { value: Number(m[1]), max: Number(m[2]), tone: TONES[m[3]] ?? null };
        } else if (line.startsWith("•")) {
          const factor = parseFactor(line);
          if (factor) data.factors.push(factor);
          if (!factor || factor.key === "other") issues.push({ type: "unrecognized_value", section, text: line.slice(0, 80) });
        } else handled = false;
        break;
      case "PERSONALITY HISTORIS":
        if ((m = /^\d+\.\s+(.+?)\s+—\s+\*\*(.+?)\*\*$/.exec(line))) {
          const quality = /EDGE HISTORIS/i.test(m[2]) ? "historicalEdge" : /SAMPEL VALID/i.test(m[2]) ? "validSample" : "other";
          pattern = {
            pattern: parsePatternName(m[1].trim()), quality,
            winRatePercent: null, averageReturnPercent: null, day3ReturnPercent: null, potentialPercent: null, drawdownPercent: null,
            takeProfitPercent: null, cutLossPercent: null, timeoutPercent: null, samples: null, profitFactor: null, averageExitDays: null,
          };
          data.patterns.push(pattern);
          if (pattern.pattern.key === "other" || quality === "other") issues.push({ type: "unrecognized_value", section, text: line.slice(0, 80) });
        } else if (pattern && (m = /^WR Event\s*([\d.]+)%\s*\|\s*rata2 event\s*(\S+)%\s*\|\s*D3\s*(\S+)%$/.exec(line))) {
          pattern.winRatePercent = Number(m[1]); pattern.averageReturnPercent = pct(`${m[2]}%`); pattern.day3ReturnPercent = pct(`${m[3]}%`);
        } else if (pattern && (m = /^potensi\s*(\S+)%\s*\|\s*DD\s*(\S+)%\s*\|\s*TP\s*([\d.]+)%\s*\|\s*CL\s*([\d.]+)%\s*\|\s*Timeout\s*([\d.]+)%$/.exec(line))) {
          pattern.potentialPercent = pct(`${m[1]}%`); pattern.drawdownPercent = pct(`${m[2]}%`);
          pattern.takeProfitPercent = Number(m[3]); pattern.cutLossPercent = Number(m[4]); pattern.timeoutPercent = Number(m[5]);
        } else if (pattern && (m = /^Sample\s*(\d+)\s*\|\s*PF\s*([\d.]+)\s*\|\s*exit avg D\+([\d.]+)$/.exec(line))) {
          pattern.samples = Number(m[1]); pattern.profitFactor = Number(m[2]); pattern.averageExitDays = Number(m[3]);
        } else handled = false;
        break;
      case "REKOMENDASI":
        if (!data.outlook && (m = /\*\*(.+?)\*\*/.exec(line))) {
          data.outlook = { ...parseStance(m[1]), entry: null, targets: [], stopLoss: null };
          if (data.outlook.stance === "other") issues.push({ type: "unrecognized_value", section, text: line.slice(0, 80) });
        } else if (data.outlook && (m = /^Entry:\s*(\S+)\s*-\s*(\S+)$/.exec(line))) {
          const [lowIdr, highIdr] = [idr(m[1]), idr(m[2])];
          data.outlook.entry = lowIdr !== null && highIdr !== null ? { lowIdr: Math.min(lowIdr, highIdr), highIdr: Math.max(lowIdr, highIdr) } : null;
        } else if (data.outlook && (m = /^Target:\s*(.+)$/.exec(line))) {
          for (const part of m[1].split(" / ")) {
            const target = /^(\S+)(?:\s*\(([^)]+)\))?$/.exec(part.trim());
            const priceIdr = target ? idr(target[1]) : null;
            if (target && priceIdr !== null) data.outlook.targets.push({ priceIdr, basis: target[2] ? TARGET_BASIS[target[2]] ?? null : null });
          }
        } else if (data.outlook && (m = /^Stop Loss:\s*(\S+)(?:\s*\(([^)]+)%\))?$/.exec(line))) {
          const priceIdr = idr(m[1]);
          data.outlook.stopLoss = priceIdr !== null ? { priceIdr, percent: m[2] ? pct(`${m[2]}%`) : null } : null;
        } else handled = false;
        break;
    }
    if (!handled) issues.push({ type: "unparsed_line", section, text: line.slice(0, 80) });
  }
  return { data, issues, recognizedSections };
}
