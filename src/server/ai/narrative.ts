import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { jakartaClock, marketPhase } from "@/lib/freshness";
import type { AiConfig } from "@/server/config/ai";
import { logInfo, logWarn } from "@/server/log";
import type { ResearchBrief } from "@/server/services/research-brief";
import { adviceWording } from "./advice-guard";
import { classifyAiError, fallbackParams, getAnthropicClient, hashedUserId } from "./client";
import { AiQuotaExceededError, AiRequestError } from "./errors";
import { validateNumbers } from "./number-validator";
import { aiQuotaStatus, reserveAiRequest, type QuotaSnapshot } from "./quota";

/**
 * Research Brief narrative (spec §3.8, rollout phase 5): Claude phrases the facts the brief already computed in
 * 3–5 neutral sentences (id or en). The output is a structured `{ sentences: string[] }`; it is shown only when
 * every number in it traces to the facts JSON (number-validator) and it carries no advice wording.
 * On rejection or error the page shows the structured brief without text, and the user is never charged.
 */

export type NarrativeLang = "id" | "en";
export type NarrativeRejection = "UNVERIFIED_NUMBERS" | "ADVICE_WORDING" | "REFUSED" | "TRUNCATED" | "MALFORMED";
export type Narrative = { code: string; lang: NarrativeLang; session: string; asOf: string; sentences: string[]; model: string; generatedAt: string };
export type NarrativeOutcome = { status: "ok"; narrative: Narrative } | { status: "rejected"; reason: NarrativeRejection };
export type NarrativeResponse = { outcome: NarrativeOutcome; cached: boolean; charged: boolean; quota: QuotaSnapshot };

const NarrativeSchema = z.object({ sentences: z.array(z.string()) });

/** Stable system prompt (cached): rules first, then a legend of the facts' keys and units. */
export const NARRATIVE_SYSTEM = `You write the optional narrative for HAKAPRO's Research Brief, a research page about one stock listed on the Indonesia Stock Exchange (IDX). The user message is a JSON object of facts that HAKAPRO's server already computed. Write 3 to 5 short, neutral sentences in the language named by "language" ("id" = Bahasa Indonesia, "en" = English) that summarise those facts for a retail investor. Return them as the "sentences" array, one sentence per item.

Rules:
1. Use only facts in the JSON. Never calculate, convert, estimate or infer a number: no sums, differences, averages, ratios, share-to-lot conversions or new percentages. Every number, percentage, money amount, date and time you write must appear in the JSON. You may round a number to fewer decimals, and you may write a large rupiah or share amount with a scale word (id: triliun, miliar, juta, ribu; en: trillion, billion, million, thousand).
2. Format numbers for the language: id uses "." for thousands and "," for decimals (Rp9.875; 3,21%); en uses "," for thousands and "." for decimals (IDR 9,875; 3.21%). Write dates as day, month name and year.
3. Start with the last price, its change and its as-of date. Then describe the evidence that has data: momentum, foreign flow, broker summary, volume, insider transactions and KSEI ownership. If "counterEvidence" is not empty, include at least one counter-evidence point. If a component's status is "missing", say in plain words which kind of data is unavailable; never guess its values. If "freshness" is "stale", say the data is not from the latest session.
4. This is research and education, not investment advice. Never recommend buying, selling or holding. Never give price targets, entry or exit levels, predictions or expectations about future prices. Never call the stock cheap, expensive, undervalued or overvalued. Never label it as being in an accumulation or distribution phase. Describe what the data shows, not what the reader should do.
5. Do not mention JSON keys, field names, table names, data providers or internal codes. Refer to the data in plain words.
6. Plain sentences only: no headings, lists, markdown, emoji or quotation of these rules.

Legend of the facts (units are part of the meaning; never mix them):
- price.lastIdr: last price in rupiah; price.changeIdr and price.changePercent: change from the previous close (percent units, 1.25 = 1.25%). asOf: when the price was observed; session: its trading date.
- completeness: how many of the evidence components have data.
- Windows 1D, 5D, 7D, 14D and 30D are the last 1, 5, 7, 14 and 30 trading sessions up to the latest session.
- momentum facts: close (rupiah), sma20 (average close of the last 20 sessions, rupiah), closeVsSma20 (above, below or at), change{window}Pct (price change over the window, percent units).
- foreign facts: net{window} (net foreign shares bought or sold over the window, from daily data; negative = net selling), buySessions and sellSessions (sessions with net foreign buying or selling within flowSessions sessions).
- broker facts: foreign{window} and domestic{window} (net value in rupiah traded by foreign and by domestic investors in the broker summary over the window; negative = net selling), start{window} and end{window} (the dates covered).
- volume facts: volumeShares, valueIdr and frequency of the latest session; avgVolumeShares, avgValueIdr and avgOrderSizeIdr (averages over baselineSessions earlier sessions); orderSizeIdr (average rupiah value per trade); volumeRatio, valueRatio and orderSizeRatio (latest divided by the average, written like 1.84x).
- insider facts: transactions, buys and sells reported within lookbackDays days up to the latest session (since = first day of that period); netShares (net shares, negative = net selling); latestDate; truncated = 1 means the list may be incomplete. insiderTransactions lists them (date, action, roles, changeShares, priceIdr).
- ksei facts: holders of at least 1% at snapshotDate (month = list month); largestHolderPct and disclosedPct (percent units); comparedWith (previous month) with counts of newHolders, increased, decreased and exited.
- counterEvidence: ready-made sentences in the requested language describing flows that point the other way from price; you may reuse their wording and numbers.`;

/** The model's whole input: the brief without internal names (tables, providers, reason codes) or personal names. */
export function narrativeFacts(brief: ResearchBrief, lang: NarrativeLang) {
  return {
    language: lang,
    stock: { code: brief.code, name: brief.name, sector: brief.sector },
    asOf: brief.asOf,
    session: brief.price.session,
    freshness: brief.freshness,
    price: { lastIdr: brief.price.last, changeIdr: brief.price.change, changePercent: brief.price.changePct },
    completeness: { componentsWithData: brief.components.filter((item) => item.status !== "missing").length, componentsTotal: brief.components.length },
    windows: brief.windows,
    components: brief.components.map((item) => (item.status === "missing"
      ? { kind: item.key, status: "missing" as const }
      : { kind: item.key, status: item.status, asOf: item.source.asOf, facts: item.raw })),
    insiderTransactions: brief.insiderTransactions.slice(0, 10).map(({ date, action, roles, changeShares, priceIdr }) => ({ date, action, roles, changeShares, priceIdr })),
    counterEvidence: brief.counterEvidence.map((item) => item.text[lang]),
  };
}

/** Pure post-check of the model's sentences against the facts. */
export function checkNarrative(sentences: string[], facts: unknown): { ok: true } | { ok: false; reason: NarrativeRejection; unknown?: number } {
  if (sentences.length < 3 || sentences.length > 5 || sentences.some((sentence) => !sentence.trim() || sentence.length > 400)) return { ok: false, reason: "MALFORMED" };
  const text = sentences.join(" ");
  if (adviceWording(text)) return { ok: false, reason: "ADVICE_WORDING" };
  const numbers = validateNumbers(text, facts);
  if (!numbers.ok) return { ok: false, reason: "UNVERIFIED_NUMBERS", unknown: numbers.unknown.length };
  return { ok: true };
}

// --- cache: per ticker, trading session and language --------------------------------------------------

const MAX_ENTRIES = 1000;
/** While the session is in progress the brief moves; a narrative is regenerated at most this often. */
const IN_SESSION_TTL_MS = 30 * 60_000;
const SETTLED_TTL_MS = 12 * 3_600_000;
/** A rejected narrative is not retried for a while, so a stubborn ticker cannot burn quota or cost. */
const REJECTED_TTL_MS = 10 * 60_000;

const cache = new Map<string, { outcome: NarrativeOutcome; expires: number }>();
const inflight = new Map<string, Promise<NarrativeOutcome>>();

export function clearNarrativeCache(): void {
  cache.clear();
  inflight.clear();
}

export type NarrativeContext = { config: AiConfig; userKey: string; now?: () => Date };

export async function getBriefNarrative(brief: ResearchBrief, lang: NarrativeLang, context: NarrativeContext): Promise<NarrativeResponse> {
  const clock = context.now ?? (() => new Date());
  const now = clock();
  const key = `${brief.code}:${brief.price.session}:${lang}`;
  const limit = context.config.dailyLimit;
  const hit = cache.get(key);
  if (hit && hit.expires > now.getTime()) return { outcome: hit.outcome, cached: true, charged: false, quota: aiQuotaStatus(context.userKey, limit, now) };
  const pending = inflight.get(key);
  if (pending) return { outcome: await pending, cached: true, charged: false, quota: aiQuotaStatus(context.userKey, limit, now) };

  const reservation = reserveAiRequest(context.userKey, limit, now);
  if (!reservation.ok) throw new AiQuotaExceededError(reservation.reason, { used: reservation.used, limit: reservation.limit, remaining: reservation.remaining });

  const run = generate(brief, lang, context, now).then((outcome) => {
    const inSession = marketPhase(jakartaClock(now)) === "in_progress";
    const ttl = outcome.status === "rejected" ? REJECTED_TTL_MS : inSession ? IN_SESSION_TTL_MS : SETTLED_TTL_MS;
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(key, { outcome, expires: now.getTime() + ttl });
    return outcome;
  }).finally(() => inflight.delete(key));
  inflight.set(key, run);

  try {
    const outcome = await run;
    // Charged only for a narrative the user can see.
    const quota = outcome.status === "ok" ? reservation.commit() : reservation.release();
    return { outcome, cached: false, charged: outcome.status === "ok", quota };
  } catch (error) {
    reservation.release();
    throw error;
  }
}

async function generate(brief: ResearchBrief, lang: NarrativeLang, context: NarrativeContext, now: Date): Promise<NarrativeOutcome> {
  const model = context.config.models.narrative;
  const facts = narrativeFacts(brief, lang);
  const started = Date.now();
  const log = { feature: "narrative", code: brief.code, lang, model };
  let response;
  try {
    response = await getAnthropicClient(context.config).beta.messages.parse({
      model,
      max_tokens: 4096,
      ...fallbackParams(model),
      system: [{ type: "text", text: NARRATIVE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: JSON.stringify(facts) }],
      output_config: { effort: "low", format: betaZodOutputFormat(NarrativeSchema) },
      metadata: { user_id: await hashedUserId(context.userKey) },
    });
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      const code = classifyAiError(error);
      logWarn("ai_request_failed", { ...log, error: code, status: error.status ?? null, latencyMs: Date.now() - started });
      throw new AiRequestError(code);
    }
    // Output that did not parse against the schema (e.g. a refusal or a truncated answer).
    logWarn("ai_narrative_rejected", { ...log, reason: "MALFORMED", latencyMs: Date.now() - started });
    return { status: "rejected", reason: "MALFORMED" };
  }
  const usage = response.usage;
  const base = {
    ...log, servedBy: response.model, stopReason: response.stop_reason, latencyMs: Date.now() - started,
    inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0, cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
  const reject = (reason: NarrativeRejection, extra: Record<string, number> = {}): NarrativeOutcome => {
    logInfo("ai_usage", { ...base, outcome: "rejected", reason, ...extra });
    return { status: "rejected", reason };
  };
  if (response.stop_reason === "refusal") return reject("REFUSED");
  if (response.stop_reason === "max_tokens") return reject("TRUNCATED");
  const sentences = response.parsed_output?.sentences?.map((sentence) => sentence.trim()) ?? null;
  if (!sentences) return reject("MALFORMED");
  const check = checkNarrative(sentences, facts);
  if (!check.ok) return reject(check.reason, check.unknown !== undefined ? { unknownNumbers: check.unknown } : {});
  logInfo("ai_usage", { ...base, outcome: "ok" });
  return { status: "ok", narrative: { code: brief.code, lang, session: brief.price.session, asOf: brief.asOf, sentences, model: response.model, generatedAt: now.toISOString() } };
}
