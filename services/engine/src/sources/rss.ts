// Minimal RSS 2.0 / Atom 1.0 reader for the news feeds (§5.7). Only the fields the engine keeps are read: title,
// link, publication date and the feed's own short description. `content:encoded` and any article body are never
// read, and article pages are never fetched (§2: headline + link only, plus the feed's own summary).
// No XML dependency: the feeds are small and flat, and anything unexpected fails the parse (raw copy marked FAILED).

export type FeedEntry = {
  title: string;
  link: string | null;
  /** `pubDate`, `dc:date`, Atom `published`/`updated`, as written in the feed. */
  date: string | null;
  /** Feed-provided description (RSS `description`, Atom `summary`), still with markup. Never `content:encoded`. */
  description: string | null;
};

export class FeedFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedFormatError";
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", middot: "·", bull: "•", copy: "©", reg: "®", trade: "™",
};

/** Decodes numeric and the common named HTML/XML entities; unknown names are left as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? match;
  });
}

/** Text content of an XML element body: CDATA unwrapped, other text entity-decoded. */
function xmlText(inner: string): string {
  let out = "";
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let last = 0;
  for (let match = cdata.exec(inner); match; match = cdata.exec(inner)) {
    out += decodeEntities(inner.slice(last, match.index)) + match[1];
    last = match.index + match[0].length;
  }
  return (out + decodeEntities(inner.slice(last))).trim();
}

/** Removes tags (and script/style contents), decodes entities and collapses whitespace. */
export function stripHtml(html: string): string {
  const withoutBlocks = html.replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const withoutTags = withoutBlocks.replace(/<\/?[a-z][^>]*>/gi, " ");
  // Decode after stripping, so escaped markup in the text stays text.
  return decodeEntities(withoutTags).replace(/\s+/g, " ").trim();
}

/** A plain-text summary of at most `max` characters (cut at a word boundary, with an ellipsis). */
export function summarize(html: string | null, max = 280): string | null {
  if (!html) return null;
  const text = stripHtml(html);
  if (!text) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:–—-]+$/, "")}…`;
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Inner text of the first `<name>` child (exact element name, so `media:title` never matches `title`). */
function child(xml: string, name: string): string | null {
  const tag = escapeRegex(name);
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${tag}\\s*>)`, "i"));
  if (!match) return null;
  const text = xmlText(match[1] ?? "");
  return text || null;
}

/** Attributes of every `<name …>` start tag in `xml`. */
function startTags(xml: string, name: string): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  const pattern = new RegExp(`<${escapeRegex(name)}(\\s[^>]*?)?/?>`, "gi");
  for (let match = pattern.exec(xml); match; match = pattern.exec(xml)) {
    const attrs: Record<string, string> = {};
    for (const attr of (match[1] ?? "").matchAll(/([a-z][\w:-]*)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
      attrs[attr[1].toLowerCase()] = decodeEntities(attr[3] ?? attr[4] ?? "");
    }
    out.push(attrs);
  }
  return out;
}

/** Splits `xml` into the bodies of each `<name>…</name>` element. */
function elements(xml: string, name: string): string[] {
  const pattern = new RegExp(`<${escapeRegex(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRegex(name)}\\s*>`, "gi");
  return [...xml.matchAll(pattern)].map((match) => match[1]);
}

const MAX_ENTRIES = 500;

/** Parses an RSS 2.0 (or RSS 1.0/RDF) or Atom 1.0 document into entries, in feed order. */
export function parseFeed(xml: string): FeedEntry[] {
  const body = xml.replace(/^﻿/, "");
  // Comments could hide or fake items; DOCTYPE/entity declarations are never expanded.
  const clean = body.replace(/<!--[\s\S]*?-->/g, "");
  if (/<rss[\s>]/i.test(clean) || /<rdf:RDF[\s>]/i.test(clean)) {
    if (!/<channel[\s>]/i.test(clean)) throw new FeedFormatError("RSS document without a channel");
    return elements(clean, "item").slice(0, MAX_ENTRIES).flatMap((item) => {
      const title = child(item, "title");
      if (!title) return [];
      const guid = item.match(/<guid(\s[^>]*)?>([\s\S]*?)<\/guid\s*>/i);
      const guidUrl = guid && !/ispermalink\s*=\s*["']false["']/i.test(guid[1] ?? "") ? xmlText(guid[2]) : null;
      return [{
        title: stripHtml(title),
        link: child(item, "link") ?? (guidUrl && /^https?:\/\//i.test(guidUrl) ? guidUrl : null),
        date: child(item, "pubDate") ?? child(item, "dc:date"),
        description: child(item, "description"),
      }];
    });
  }
  if (/<feed[\s>]/i.test(clean)) {
    return elements(clean, "entry").slice(0, MAX_ENTRIES).flatMap((entry) => {
      const title = child(entry, "title");
      if (!title) return [];
      const links = startTags(entry, "link");
      const link = links.find((attrs) => !attrs.rel || attrs.rel === "alternate")?.href ?? links[0]?.href ?? null;
      return [{
        title: stripHtml(title),
        link: link || null,
        date: child(entry, "published") ?? child(entry, "updated"),
        description: child(entry, "summary"),
      }];
    });
  }
  throw new FeedFormatError("Not an RSS or Atom document");
}

// ── dates ───────────────────────────────────────────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  // Indonesian spellings seen in local feeds.
  mei: 5, agu: 8, ags: 8, okt: 10, des: 12,
};

/** Named zones in RFC 822 dates (plus the Indonesian ones some local feeds write). Hours east of UTC. */
const ZONES: Record<string, number> = {
  UT: 0, UTC: 0, GMT: 0, Z: 0, WIB: 7, WITA: 8, WIT: 9,
  EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7,
};

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Parses a feed date: RFC 822/2822 (`Fri, 16 Oct 2026 14:16:31 +0700`, `GMT`, `WIB`, two-digit years) or ISO 8601
 * (`2026-10-16T14:16:31+07:00`). A date without any zone is read as WIB (the feeds are Indonesian). Null when the
 * text is not a date this function can vouch for.
 */
export function parseFeedDate(text: string | null): Date | null {
  if (!text) return null;
  const value = text.trim();
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i);
  if (iso) {
    const [, y, mo, d, h = "00", mi = "00", s = "00", zone] = iso;
    const offset = !zone ? "+07:00" : zone.toUpperCase() === "Z" ? "Z" : `${zone.slice(0, 3)}:${zone.slice(-2)}`;
    return valid(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`, Number(mo), Number(d));
  }
  const rfc = value.match(/^(?:[a-z]{3,},?\s+)?(\d{1,2})\s+([a-z]{3,})\.?\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|[a-z]{1,4})?$/i);
  if (!rfc) return null;
  const [, d, monthName, yearText, h, mi, s = "00", zone] = rfc;
  const month = MONTHS[monthName.slice(0, 3).toLowerCase()];
  if (!month) return null;
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  if (yearText.length === 3) return null;
  let offset = "+07:00";
  if (zone) {
    if (/^[+-]\d{4}$/.test(zone)) offset = `${zone.slice(0, 3)}:${zone.slice(3)}`;
    else {
      const hours = ZONES[zone.toUpperCase()];
      if (hours === undefined) return null;
      offset = `${hours < 0 ? "-" : "+"}${pad(Math.abs(hours))}:00`;
    }
  }
  return valid(`${year}-${pad(month)}-${pad(Number(d))}T${pad(Number(h))}:${mi}:${s}${offset}`, month, Number(d));
}

/** Rejects calendar dates that do not exist (31 Feb), which the Date parser would roll over or refuse. */
function valid(isoText: string, month: number, day: number): Date | null {
  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) return null;
  const year = Number(isoText.slice(0, 4));
  const calendar = new Date(Date.UTC(year, month - 1, day));
  return calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day ? date : null;
}
