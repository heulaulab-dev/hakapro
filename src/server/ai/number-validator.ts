/**
 * Number validator for model-written text (spec §3.2 "no LLM-generated numbers", §3.8): every number,
 * percentage, money amount, date and time in the text must be traceable to the input JSON the model was
 * given. Pure and deterministic; used for the Research Brief narrative and the copilot answer.
 *
 * What counts as a match (the documented rounding allowance):
 * - Formats: Indonesian "1.234,5" and English "1,234.5". A single separator followed by exactly three digits
 *   ("1.234") is ambiguous, so both readings (1234 and 1.234) are tried.
 * - Scale words multiply the number: T/triliun/trillion 10^12; miliar/billion/B 10^9; juta/jt/million 10^6;
 *   ribu/rb/K/thousand 10^3. "M" is tried as both miliar (id, 10^9) and million (en, 10^6), as the app's own
 *   formatter uses it in both senses.
 * - Rounding: a shown number matches a source value when the source value rounds to it at the shown precision,
 *   i.e. |shown − |source|| ≤ half a unit of the last shown digit (× scale). "Rp 2,1 T" matches 2.14e12 but not
 *   2.2e12. Signs are ignored ("jual bersih 1,2 T" states −1.2e12).
 * - Exception: a bare integer below 10 (no decimals, scale or %) must equal an integer source value exactly, so
 *   "3 transaksi" cannot ride on an unrelated 3.2 elsewhere in the JSON.
 * - Percentages also match a fraction × 100 (confidence 0.67 → "67%").
 * - Dates ("2026-10-21", "21 Oktober 2026", "21 Okt 2026", "October 21, 2026", "21/10/2026") must be a date in the
 *   JSON; "Oktober 2026" must be a month with a date in the JSON; "21 Okt" a day-month in the JSON; a bare year a
 *   year in the JSON; "15:49" a time in the JSON (timestamps count in UTC and WIB).
 * - Numbers inside JSON strings (e.g. counter-evidence sentences, window labels "5D") are allowed too.
 * - Digits glued to letters ("Q3", "BBCA1", "change5DPct") are not read as numbers; "5D" and "2,5x" are.
 *
 * The check is existence, not attribution: it proves a number came from the input, not that the sentence
 * attaches it to the right field. The prompt, the golden-set evals and the neutral-wording guard cover that.
 */

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, febr: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3, apr: 4, april: 4,
  mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, agu: 8, agt: 8, agus: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, nopember: 11, november: 11,
  des: 12, desember: 12, dec: 12, december: 12,
};
const MONTH = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const NOT_LETTER = "(?![\\p{L}])";
const NOT_DIGIT_BEFORE = "(?<![\\p{L}\\p{N}_])";

const SCALE_WORDS: Array<[string, number[]]> = [
  ["triliun|trilyun|trillions?|tn|trn|T", [1e12]],
  ["miliar|milyar|billions?|bn|B", [1e9]],
  ["M", [1e9, 1e6]],
  ["juta|millions?|mn|jt", [1e6]],
  ["ribu|thousands?|rb|K|k", [1e3]],
];
const SCALE_ALT = SCALE_WORDS.map(([words]) => words).join("|");

const PATTERNS = {
  isoDate: /(?<![\p{N}])(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?(?![\p{N}])/gu,
  dayMonthYear: new RegExp(`${NOT_DIGIT_BEFORE}(\\d{1,2})\\s+(${MONTH})\\.?${NOT_LETTER},?\\s+(\\d{4})(?![\\p{N}])`, "giu"),
  monthDayYear: new RegExp(`(?<![\\p{L}])(${MONTH})\\.?${NOT_LETTER}\\s+(\\d{1,2}),?\\s+(\\d{4})(?![\\p{N}])`, "giu"),
  slashDate: /(?<![\p{N}/])(\d{1,2})\/(\d{1,2})\/(\d{4})(?![\p{N}])/gu,
  monthYear: new RegExp(`(?<![\\p{L}])(${MONTH})\\.?${NOT_LETTER},?\\s+(\\d{4})(?![\\p{N}])`, "giu"),
  dayMonth: new RegExp(`${NOT_DIGIT_BEFORE}(\\d{1,2})\\s+(${MONTH})\\.?${NOT_LETTER}`, "giu"),
  time: /(?<![\p{N}:])(\d{1,2}):(\d{2})(?::\d{2})?(?![\p{N}])/gu,
  number: new RegExp(`${NOT_DIGIT_BEFORE}[+\\-−]?(\\d+(?:[.,]\\d+)*)(?:\\s?(${SCALE_ALT})${NOT_LETTER})?(?:\\s?(%|persen${NOT_LETTER}|percent${NOT_LETTER}|pct${NOT_LETTER}))?`, "gu"),
};

type Reading = { value: number; decimals: number };
export type Token =
  | { kind: "number"; raw: string; readings: Reading[]; scales: number[]; percent: boolean }
  | { kind: "date"; raw: string; dates: string[] }
  | { kind: "month"; raw: string; month: string }
  | { kind: "dayMonth"; raw: string; dayMonth: string }
  | { kind: "time"; raw: string; time: string };

const pad = (value: number | string) => String(value).padStart(2, "0");
const iso = (year: number | string, month: number, day: number | string) => `${year}-${pad(month)}-${pad(day)}`;
const validDate = (year: number, month: number, day: number) => month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900 && year <= 2200;

/** Both readings of an ambiguous separator; the last of two different separators is the decimal one. */
export function readings(body: string): Reading[] {
  const hasDot = body.includes("."), hasComma = body.includes(",");
  if (!hasDot && !hasComma) return [{ value: Number(body), decimals: 0 }];
  if (hasDot && hasComma) {
    const last = Math.max(body.lastIndexOf("."), body.lastIndexOf(","));
    const fraction = body.slice(last + 1);
    return [{ value: Number(`${body.slice(0, last).replace(/[.,]/g, "")}.${fraction}`), decimals: fraction.length }];
  }
  const parts = body.split(hasDot ? "." : ",");
  if (parts.length > 2) return [{ value: Number(parts.join("")), decimals: 0 }];
  const [whole, fraction] = parts;
  const out: Reading[] = [{ value: Number(`${whole}.${fraction}`), decimals: fraction.length }];
  if (fraction.length === 3 && whole !== "0") out.push({ value: Number(`${whole}${fraction}`), decimals: 0 });
  return out;
}

function scalesFor(word: string | undefined): number[] {
  if (!word) return [1];
  for (const [words, scales] of SCALE_WORDS) {
    if (new RegExp(`^(?:${words})$`, /^[A-Z]$/.test(word) ? "u" : "iu").test(word)) return scales;
  }
  return [1];
}

/** Tokenizes in a fixed order (dates first), blanking each match so its digits are not read again as numbers. */
export function tokenize(input: string): Token[] {
  // "Rp2,1 T" / "IDR2.1T": the currency prefix is glued to the digits; separate it.
  let text = input.replace(/(Rp|IDR|USD|US\$)\.?(?=\d)/gi, "$1 ");
  const tokens: Token[] = [];
  const take = (pattern: RegExp, build: (match: RegExpExecArray) => Token | null) => {
    text = text.replace(pattern, (...args) => {
      const match = args.slice(0, -2) as unknown as RegExpExecArray;
      const token = build(match);
      if (!token) return match[0];
      tokens.push(token);
      return " ".repeat(match[0].length);
    });
  };
  take(PATTERNS.isoDate, (m) => {
    const dates = [iso(m[1], Number(m[2]), m[3])];
    if (m[4] !== undefined) {
      const instant = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${m[6] ?? "+07:00"}`);
      if (!Number.isNaN(instant.getTime())) dates.push(wibDate(instant));
    }
    return { kind: "date", raw: m[0], dates };
  });
  take(PATTERNS.dayMonthYear, (m) => (validDate(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1])) ? { kind: "date", raw: m[0], dates: [iso(m[3], MONTHS[m[2].toLowerCase()], m[1])] } : null));
  take(PATTERNS.monthDayYear, (m) => (validDate(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2])) ? { kind: "date", raw: m[0], dates: [iso(m[3], MONTHS[m[1].toLowerCase()], m[2])] } : null));
  take(PATTERNS.slashDate, (m) => {
    const [a, b, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dates = [validDate(year, b, a) ? iso(year, b, a) : null, validDate(year, a, b) ? iso(year, a, b) : null].filter((date): date is string => date !== null);
    return dates.length ? { kind: "date", raw: m[0], dates } : null;
  });
  take(PATTERNS.monthYear, (m) => ({ kind: "month", raw: m[0], month: `${m[2]}-${pad(MONTHS[m[1].toLowerCase()])}` }));
  take(PATTERNS.dayMonth, (m) => (Number(m[1]) >= 1 && Number(m[1]) <= 31 ? { kind: "dayMonth", raw: m[0], dayMonth: `${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}` } : null));
  take(PATTERNS.time, (m) => (Number(m[1]) < 24 && Number(m[2]) < 60 ? { kind: "time", raw: m[0], time: `${pad(m[1])}:${m[2]}` } : null));
  take(PATTERNS.number, (m) => ({ kind: "number", raw: m[0].trim(), readings: readings(m[1]), scales: scalesFor(m[2]), percent: m[3] !== undefined }));
  return tokens;
}

function wibDate(instant: Date): string {
  return new Date(instant.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}
function wibTime(instant: Date): string {
  return new Date(instant.getTime() + 7 * 3_600_000).toISOString().slice(11, 16);
}

export type Allowed = { numbers: number[]; integers: Set<number>; dates: Set<string>; months: Set<string>; dayMonths: Set<string>; times: Set<string> };

function addDate(allowed: Allowed, date: string) {
  allowed.dates.add(date);
  allowed.months.add(date.slice(0, 7));
  allowed.dayMonths.add(date.slice(5, 10));
  addNumber(allowed, Number(date.slice(0, 4)));
}

function addNumber(allowed: Allowed, value: number) {
  if (!Number.isFinite(value)) return;
  allowed.numbers.push(Math.abs(value));
  if (Number.isInteger(value)) allowed.integers.add(Math.abs(value));
}

function addString(allowed: Allowed, value: string) {
  // Whole timestamps: the date in UTC and in WIB, and the time in both.
  const stamp = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(value);
  if (stamp) {
    const instant = new Date(`${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:00${stamp[6] ?? "+07:00"}`);
    addDate(allowed, `${stamp[1]}-${stamp[2]}-${stamp[3]}`);
    allowed.times.add(`${stamp[4]}:${stamp[5]}`);
    if (!Number.isNaN(instant.getTime())) {
      addDate(allowed, wibDate(instant));
      allowed.times.add(wibTime(instant));
    }
    return;
  }
  if (/^\d{4}-\d{2}$/.test(value)) {
    allowed.months.add(value);
    addNumber(allowed, Number(value.slice(0, 4)));
    return;
  }
  for (const token of tokenize(value)) {
    if (token.kind === "date") token.dates.forEach((date) => addDate(allowed, date));
    else if (token.kind === "month") { allowed.months.add(token.month); addNumber(allowed, Number(token.month.slice(0, 4))); }
    else if (token.kind === "dayMonth") allowed.dayMonths.add(token.dayMonth);
    else if (token.kind === "time") allowed.times.add(token.time);
    else for (const reading of token.readings) for (const scale of token.scales) addNumber(allowed, reading.value * scale);
  }
}

/** Every number, date, month and time the sources contain, walking objects and arrays (values only, not keys). */
export function collectAllowed(...sources: unknown[]): Allowed {
  const allowed: Allowed = { numbers: [], integers: new Set(), dates: new Set(), months: new Set(), dayMonths: new Set(), times: new Set() };
  const walk = (value: unknown) => {
    if (typeof value === "number") addNumber(allowed, value);
    else if (typeof value === "string") addString(allowed, value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  sources.forEach(walk);
  return allowed;
}

function numberMatches(token: Extract<Token, { kind: "number" }>, allowed: Allowed): boolean {
  for (const reading of token.readings) {
    if (!Number.isFinite(reading.value)) continue;
    const bareSmallInteger = !token.percent && token.scales.length === 1 && token.scales[0] === 1 && reading.decimals === 0 && reading.value < 10;
    if (bareSmallInteger) {
      if (allowed.integers.has(reading.value)) return true;
      continue;
    }
    for (const scale of token.scales) {
      const shown = reading.value * scale;
      const tolerance = 0.5 * 10 ** -reading.decimals * scale;
      for (const source of allowed.numbers) {
        const targets = token.percent ? [source, source * 100] : [source];
        for (const target of targets) if (Math.abs(shown - target) <= tolerance + 1e-9 * Math.max(1, target)) return true;
      }
    }
  }
  return false;
}

export type NumberCheck = { ok: boolean; checked: number; unknown: string[] };

/** Checks every number-like token in `text` against the values found in `sources`. */
export function validateNumbers(text: string, ...sources: unknown[]): NumberCheck {
  const allowed = collectAllowed(...sources);
  const tokens = tokenize(text);
  const unknown: string[] = [];
  for (const token of tokens) {
    const ok = token.kind === "date" ? token.dates.some((date) => allowed.dates.has(date))
      : token.kind === "month" ? allowed.months.has(token.month)
      : token.kind === "dayMonth" ? allowed.dayMonths.has(token.dayMonth)
      : token.kind === "time" ? allowed.times.has(token.time)
      : numberMatches(token, allowed);
    if (!ok) unknown.push(token.raw);
  }
  return { ok: unknown.length === 0, checked: tokens.length, unknown };
}
