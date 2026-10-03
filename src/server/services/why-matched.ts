/**
 * Turns the provider's emoji-encoded strategy screener into structured, descriptive criteria.
 * Criteria describe what was observed; they are never recommendations.
 *
 * Source: arjum `/api/screener/latest` (`bucket`, `summary` flags, `note`, and the legend in `raw`).
 */
import type { ScreenerResponse } from "@/server/schemas/arjum";
import { parseIndonesianDate } from "./screener-date";
import { parseProviderNumber } from "./parse-number";

/** Explicit mapping table for known flags. Keys feed i18n message ids (`criteria.<key>`). */
export const KNOWN_FLAGS = {
  "✅": { key: "accumulation", providerLabel: "akumulasi" },
  "❌": { key: "distribution", providerLabel: "distribusi" },
  "🏦": { key: "brokerConcentration", providerLabel: "broker pekat" },
  "🏛️": { key: "institutional", providerLabel: "institusi" },
  "🌍": { key: "foreignBuying", providerLabel: "asing beli" },
  "🔬": { key: "strongTechnicals", providerLabel: "teknikal kuat" },
  "🥷": { key: "quietAccumulation", providerLabel: "senyap" },
  "🧬": { key: "historicalEdge", providerLabel: "edge historis" },
  "🧨": { key: "historicalTrap", providerLabel: "jebakan historis" },
  "🚀⚠️": { key: "pumpRisk", providerLabel: "pompa" },
  "⏰": { key: "lateEntry", providerLabel: "telat" },
  "🔥": { key: "climax", providerLabel: "klimaks" },
} as const;

/**
 * Recognized but deliberately not shown: the direction arrow is the provider's forward-looking call
 * (MIGRATION §9.5 — no signals). Listed explicitly so they are neither displayed nor "unrecognized".
 */
export const OMITTED_FLAGS = ["⬆️", "⬇️", "⬆", "⬇"] as const;

export type CriterionKey = (typeof KNOWN_FLAGS)[keyof typeof KNOWN_FLAGS]["key"];
export type Criterion =
  | { kind: "recognized"; key: CriterionKey; flag: string }
  | { kind: "unrecognized"; flag: string; providerLabel: string | null };

export type StrategyMatch = {
  symbol: string;
  name: string;
  criteria: Criterion[];
  /** Provider's descriptive pattern label, e.g. "Gabungan (Asing + Teknikal)". Stats are stripped. */
  pattern: string | null;
  /** Observed facts from the provider note, e.g. ["jatuh tajam", "teknikal lemah"]. */
  notes: string[];
};
export type Strategy = { id: string; name: string; description: string | null; matches: StrategyMatch[] };
export type StrategyScreen = {
  date: string | null;
  screenerVersion: string | null;
  marketCondition: { label: string; averageChangePercent: number | null } | null;
  universe: { covered: number; liquid: number; skipped: number } | null;
  strategies: Strategy[];
};

export type WhyMatchedIssue =
  | { type: "unrecognized_flag"; flag: string; symbol: string; providerLabel: string | null }
  | { type: "legend_drift"; flag: string; expected: string; actual: string }
  | { type: "unparseable_date"; text: string }
  | { type: "summary_noise"; symbol: string; text: string };

const stripVariation = (value: string) => value.replace(/️/g, "");
const FLAG_ENTRIES = Object.entries(KNOWN_FLAGS)
  .map(([flag, meta]) => ({ flag, bare: stripVariation(flag), meta }))
  .sort((a, b) => b.bare.length - a.bare.length);

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Legend line: `_✅=akumulasi | ❌=distribusi | …_` → bare-flag → provider label. */
export function parseLegend(raw: string): Map<string, string> {
  const legend = new Map<string, string>();
  const line = raw.split("\n").find((candidate) => /=/.test(candidate) && candidate.includes("|"));
  if (!line) return legend;
  for (const entry of line.replace(/^_|_$/g, "").split("|")) {
    const [flag, label] = entry.split("=").map((part) => part.trim());
    if (flag && label) legend.set(stripVariation(flag), label);
  }
  return legend;
}

/** Bucket headings: `**🥷 AKUMULASI SENYAP** — description` → bucket text → description. */
export function parseBucketDescriptions(raw: string): Map<string, string> {
  const descriptions = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const match = /^\*\*(.+?)\*\*\s+[—-]\s+(.+)$/.exec(line.trim());
    if (match && !/SCREENER|MARKET|Disclaimer/i.test(match[1])) descriptions.set(match[1].trim(), match[2].trim());
  }
  return descriptions;
}

export function tokenizeFlags(summary: string): string[] {
  const flags: string[] = [];
  for (const token of summary.split(/\s+/).filter(Boolean)) {
    let rest = stripVariation(token);
    while (rest) {
      const known = FLAG_ENTRIES.find((entry) => rest.startsWith(entry.bare));
      if (known) {
        flags.push(known.flag);
        rest = rest.slice(known.bare.length);
        continue;
      }
      const [first] = segmenter.segment(rest);
      // Keep runs of plain text together so noise is reported once, not character by character.
      if (!isPictographic(first.segment) && flags.length && !isPictographic(flags[flags.length - 1]) && !FLAG_ENTRIES.some((entry) => entry.flag === flags[flags.length - 1])) {
        flags[flags.length - 1] += first.segment;
      } else {
        flags.push(first.segment);
      }
      rest = rest.slice(first.segment.length);
    }
  }
  return flags;
}

const SEPARATOR = /\s+[—–]\s+/;
/** Forward-looking numbers (win rate, average event return, D3, potential, drawdown) start here. */
const STATS_START = /\s*(WR\s*Event|rata2\s*event|D3[+-]|potensi|\|\s*DD)/i;
const isPictographic = (grapheme: string) => /\p{Extended_Pictographic}|\p{Emoji_Presentation}/u.test(grapheme);

/**
 * Splits a provider summary into flag graphemes and a descriptive pattern label:
 *   "🧬 ⬆️ — Gabungan (Asing + Teknikal) WR Event71.4% … | DD -5% (+12)" →
 *   flags ["🧬", "⬆️"], pattern "Gabungan (Asing + Teknikal)".
 * Non-emoji text before the separator (a provider glitch like "Tbk.)") is returned as noise.
 */
export function splitSummary(summary: string): { flags: string[]; pattern: string | null; noise: string[] } {
  const [flagPart, ...rest] = summary.split(SEPARATOR);
  const detail = rest.join(" — ");
  const flags: string[] = [];
  const noise: string[] = [];
  for (const token of tokenizeFlags(flagPart)) {
    if (isPictographic(token) || FLAG_ENTRIES.some((entry) => entry.flag === token)) flags.push(token);
    else noise.push(token);
  }
  const pattern = detail ? detail.split(STATS_START)[0].trim() || null : null;
  return { flags, pattern, noise: noise.length ? [noise.join("").trim()].filter(Boolean) : [] };
}

export function strategyId(bucket: string): string {
  return bucketName(bucket).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function bucketName(bucket: string): string {
  // Drop leading emoji/pictographs: "🥷 AKUMULASI SENYAP" → "AKUMULASI SENYAP".
  return bucket.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

function parseMarketCondition(raw: string): StrategyScreen["marketCondition"] {
  const line = raw.split("\n").find((candidate) => /\*\*[^*]*MARKET\*\*/.test(candidate));
  if (!line) return null;
  const label = /\*\*([^*]*MARKET)\*\*/.exec(line)?.[1]?.trim();
  if (!label) return null;
  const average = /Rata-rata\s+([+\-−]?[\d.,]+%)/.exec(line)?.[1];
  const parsed = average ? parseProviderNumber(average, { unit: "percent", separators: "en" }) : null;
  return { label, averageChangePercent: parsed?.ok ? parsed.quantity.value : null };
}

function parseUniverse(raw: string): StrategyScreen["universe"] {
  const match = /(\d+)\s+terdata\s*\|\s*(\d+)\s+likuid\s*\|\s*(\d+)\s+skip/.exec(raw);
  return match ? { covered: Number(match[1]), liquid: Number(match[2]), skipped: Number(match[3]) } : null;
}

export function parseStrategyScreen(response: ScreenerResponse): { screen: StrategyScreen; issues: WhyMatchedIssue[] } {
  const issues: WhyMatchedIssue[] = [];
  const legend = parseLegend(response.raw);
  for (const entry of FLAG_ENTRIES) {
    const actual = legend.get(entry.bare);
    if (actual && actual !== entry.meta.providerLabel) issues.push({ type: "legend_drift", flag: entry.flag, expected: entry.meta.providerLabel, actual });
  }
  const descriptions = parseBucketDescriptions(response.raw);
  const date = parseIndonesianDate(response.date);
  if (!date) issues.push({ type: "unparseable_date", text: response.date });

  const strategies = new Map<string, Strategy>();
  for (const row of response.rows) {
    const id = strategyId(row.bucket);
    if (!strategies.has(id)) {
      strategies.set(id, { id, name: bucketName(row.bucket), description: descriptions.get(row.bucket.trim()) ?? null, matches: [] });
    }
    const { flags, pattern, noise } = splitSummary(row.summary);
    for (const text of noise) issues.push({ type: "summary_noise", symbol: row.stock_code, text });
    const omitted = new Set(OMITTED_FLAGS.map(stripVariation));
    const criteria: Criterion[] = flags.filter((flag) => !omitted.has(stripVariation(flag))).map((flag) => {
      const known = FLAG_ENTRIES.find((entry) => entry.flag === flag);
      if (known) return { kind: "recognized", key: known.meta.key, flag };
      const providerLabel = legend.get(stripVariation(flag)) ?? null;
      issues.push({ type: "unrecognized_flag", flag, symbol: row.stock_code, providerLabel });
      return { kind: "unrecognized", flag, providerLabel };
    });
    const notes = row.note.split("|").map((part) => part.trim()).filter(Boolean);
    strategies.get(id)!.matches.push({ symbol: row.stock_code, name: row.stock_name, criteria, pattern, notes });
  }

  return {
    screen: {
      date,
      screenerVersion: /SCREENER\s+(V[\d.]+)/i.exec(response.date)?.[1] ?? null,
      marketCondition: parseMarketCondition(response.raw),
      universe: parseUniverse(response.raw),
      strategies: [...strategies.values()],
    },
    issues,
  };
}
