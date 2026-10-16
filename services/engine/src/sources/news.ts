// News RSS feeds (DATA-ENGINE.md §5.7, §5.11 item 4): the four OK outlets. Stored per item: headline, canonical link,
// publication time, outlet, a short summary only when the feed itself carries a description (≤ 280 chars, plain
// text), and the IDX symbols the headline names. Article pages are never fetched and bodies never stored (§2).
import { parseFeed, parseFeedDate, summarize } from "./rss";

export type NewsFeed = {
  /** Source id (one per outlet host; InvestorTrust's two feeds share one). */
  sourceId: string;
  host: string;
  outlet: string;
  url: string;
};

export const NEWS_SOURCE_IDS = {
  cnbc: "news-cnbcindonesia",
  detik: "news-detik",
  antara: "news-antara",
  investortrust: "news-investortrust",
} as const;

export const NEWS_FEEDS: NewsFeed[] = [
  { sourceId: NEWS_SOURCE_IDS.cnbc, host: "www.cnbcindonesia.com", outlet: "CNBC Indonesia", url: "https://www.cnbcindonesia.com/market/rss" },
  { sourceId: NEWS_SOURCE_IDS.detik, host: "finance.detik.com", outlet: "detikFinance", url: "https://finance.detik.com/rss" },
  { sourceId: NEWS_SOURCE_IDS.antara, host: "www.antaranews.com", outlet: "ANTARA", url: "https://www.antaranews.com/rss/ekonomi-bursa.xml" },
  { sourceId: NEWS_SOURCE_IDS.investortrust, host: "investortrust.id", outlet: "Investortrust", url: "https://investortrust.id/rss/market.rss" },
  { sourceId: NEWS_SOURCE_IDS.investortrust, host: "investortrust.id", outlet: "Investortrust", url: "https://investortrust.id/rss/macro.rss" },
];

export const FEED_ACCEPT = "application/rss+xml, application/atom+xml;q=0.9, application/xml;q=0.8, text/xml;q=0.8, */*;q=0.1";
export const SUMMARY_MAX = 280;
/** A feed date more than this far after the fetch is not trusted (wrong zone or a placeholder). */
const MAX_FUTURE_MS = 60 * 60 * 1000;

// ── canonical link and title key (dedupe) ───────────────────────────────────────────────────────────────────────

const TRACKING_PARAM = /^(utm_[a-z_]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|igshid|ref|ref_src|src|source|from|amp|cmpid)$/i;

/** http(s) link with lower-cased host, no fragment, no tracking parameters and no trailing slash; null otherwise. */
export function canonicalUrl(link: string | null): string | null {
  if (!link) return null;
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  url.hash = "";
  for (const name of [...url.searchParams.keys()]) if (TRACKING_PARAM.test(name)) url.searchParams.delete(name);
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\?$/, "");
}

/** Lower-case, accent-free, punctuation-free title: the same story with different quotes or casing collides. */
export function titleKey(title: string): string {
  return title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// ── symbols ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Four-letter words that are listed tickers but also common words, abbreviations or names in headlines. A bare
 * match on one of these is ignored; `$BANK` still counts. Abbreviations that are not tickers are listed too, so a
 * future listing with that code does not start matching every macro headline.
 */
export const SYMBOL_STOPLIST: ReadonlySet<string> = new Set([
  // Market, policy and institution abbreviations (most are not tickers today; listed so a new listing cannot match them).
  "IHSG", "MSCI", "FTSE", "KSEI", "BUMN", "BUMD", "APBN", "APBD", "RUPS", "BPJS", "KSSK", "SRBI", "SBSN", "ORIS", "FOMC",
  "ESDM", "PLTU", "PLTS", "PLTA", "OPEC", "NATO", "OECD", "BRIN", "PKPU", "NPWP", "LPEI", "UMKM", "CASA", "CPNS", "PPKM",
  "KUHP", "DPRD", "NYSE", "AMEX", "POJK", "PBOC", "BRIC", "WITA",
  // Tickers that are also everyday words, brands or place names when written in capitals.
  "BANK", "GOOD", "MEGA", "BALI", "DATA", "FAST", "META", "KING", "LAND", "CITY", "HERO", "BEST", "LIFE", "SAFE", "NICE",
  "PURE", "OPEN", "PLAN", "TEXT", "ZONE", "WINS", "JAWA", "BOLA", "SOHO", "CASH", "GOLD", "BIRD", "BOSS", "MAIN", "PORT",
  "RISE", "ROCK", "SHIP", "AUTO", "FOOD", "HOME", "HOPE", "IDEA", "INDO", "JAYA", "LUCK", "NEST", "SAME", "TECH", "TRUE",
  "ASIA", "CUAN", "MARI", "SINI", "UANG",
]);

/** Share of upper-case letters above which a text is "shouting" and bare tickers are not trusted. */
const SHOUTING_RATIO = 0.6;

/**
 * IDX symbols named in a headline/summary, conservatively: `$BBCA` (or `$bbca`) always counts when the symbol is
 * known; a bare upper-case four-letter word counts only when it is a known symbol, not on the stoplist, and the text
 * is not written in capitals. Unknown codes never match. Sorted, unique.
 */
export function matchSymbols(text: string, known: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/(?<![\w$])\$([A-Za-z]{4})(?![\w])/g)) {
    const symbol = match[1].toUpperCase();
    if (known.has(symbol)) found.add(symbol);
  }
  const letters = text.replace(/[^\p{L}]/gu, "");
  const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
  if (letters.length && upper / letters.length < SHOUTING_RATIO) {
    for (const match of text.matchAll(/(?<![\p{L}\p{N}$_-])([A-Z]{4})(?![\p{L}\p{N}_-])/gu)) {
      const symbol = match[1];
      if (known.has(symbol) && !SYMBOL_STOPLIST.has(symbol)) found.add(symbol);
    }
  }
  return [...found].sort();
}

// ── items ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type NewsItemParsed = {
  url: string;
  title: string;
  titleKey: string;
  publishedAt: Date;
  /** True when the feed date was missing or unusable and the fetch time stands in for it. */
  publishedAtEstimated: boolean;
  summary: string | null;
  outlet: string;
  symbols: string[];
};

/**
 * Parses one feed document into storable items. Entries without a usable http(s) link or title are skipped, as are
 * repeats within the document (same canonical link or title key).
 */
export function parseNewsFeed(xml: string, feed: Pick<NewsFeed, "outlet">, fetchedAt: Date, known: ReadonlySet<string>): { items: NewsItemParsed[]; skipped: number } {
  const entries = parseFeed(xml);
  const items: NewsItemParsed[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const entry of entries) {
    const url = canonicalUrl(entry.link);
    const title = entry.title.slice(0, 500);
    const key = titleKey(title);
    if (!url || !key || seen.has(url) || seen.has(`title:${key}`)) { skipped += 1; continue; }
    seen.add(url);
    seen.add(`title:${key}`);
    const parsedDate = parseFeedDate(entry.date);
    const usable = parsedDate !== null && parsedDate.getTime() <= fetchedAt.getTime() + MAX_FUTURE_MS;
    const summary = summarize(entry.description, SUMMARY_MAX);
    items.push({
      url, title, titleKey: key,
      publishedAt: usable ? parsedDate : fetchedAt,
      publishedAtEstimated: !usable,
      // A description that only repeats the headline adds nothing.
      summary: summary && titleKey(summary) !== key ? summary : null,
      outlet: feed.outlet,
      symbols: matchSymbols(`${title}\n${summary ?? ""}`, known),
    });
  }
  return { items, skipped };
}
