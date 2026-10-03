/**
 * Groups disclosed insider transactions by holder for the Insiders tab (CONNECTION-NETWORK.md §3, N1 decision).
 * Pure and descriptive: it reports what the filings say, never infers identity, relationships or intent.
 *
 * - Organisations merge on exact equality after legal-form normalisation ("PT X Tbk" = "X").
 * - People (and names of unknown type) merge only on exact, case/whitespace-insensitive equality, and every
 *   group of that kind is labelled "identity not verified".
 * - Custodian / nominee account names get their own kind and are never presented as owners.
 * - When the newest date holds several rows with different resulting holdings, the latest holding is
 *   "ambiguous" and all values are kept; none is picked.
 */
import type { InsiderRow } from "@/lib/api/market";

export type HolderKind = "organization" | "person" | "nominee" | "unknown";
export type DisclosedRole = "director" | "commissioner" | "controller";

export type HolderHolding = { shares: number | null; percent: number | null };
export type HolderGroup = {
  key: string;
  kind: HolderKind;
  /** Raw disclosed names in this group, newest first. Always shown; the key is never displayed alone. */
  names: string[];
  roles: DisclosedRole[];
  /** Badges we don't map, shown verbatim. */
  otherBadges: string[];
  /** True for people and unknown-type names: grouped by exact name only. */
  identityUnverified: boolean;
  latest: { date: string; holdings: HolderHolding[]; ambiguous: boolean };
  firstDate: string;
  events: InsiderRow[];
  /** Other groups in this set whose organisation key is a prefix of this one (or vice versa) — e.g. a truncated name. Never merged. */
  possiblySameAs: string[];
};

const ROLE_BADGES: Record<string, DisclosedRole> = { DIREKTUR: "director", KOMISARIS: "commissioner", PENGENDALI: "controller" };

/** Account names that denote a custodian, nominee or client account (registered holder, not owner). */
const NOMINEE_PATTERNS = [
  /\bA\/C\b/, /\bCLIENTS?\b/, /\bNOMINEES?\b/, /\bCUSTOD(Y|IAN)\b/, /\bS\/A\b/, /\bQQ\b/,
  /\bBANK OF NEW YORK MELLON\b/, /\bSTATE STREET\b/, /\bCITIBANK\b/, /\bHSBC\b/, /\bJP ?MORGAN CHASE BANK\b/, /\bDEUTSCHE BANK\b/,
  /\bSTANDARD CHARTERED BANK\b/, /\bUOB KAY HIAN\b/, /\bBANK OF SINGAPORE\b/, /\bDBS (BANK|VICKERS)\b/, /\bUBS AG\b/,
  /\bMORGAN STANLEY (AND|&) CO\b/, /\bJULIUS BAER\b/, /\bUNION BANCAIRE PRIVEE\b/,
];
const LEGAL_FORM = /\b(PT|TBK|PERSERO|PERUSAHAAN PERSEROAN|LTD|LIMITED|PTE|INC|CORP|CORPORATION|LLC|PLC|BV|NV|GMBH|SA|AG|SPC|BHD|SDN)\b/g;
const ORG_HINT = /\b(PT|TBK|PERSERO|LTD|LIMITED|PTE|INC|CORP|CORPORATION|LLC|PLC|GMBH|SPC|BHD|HOLDCO|HOLDINGS?|INVESTMENTS?|INVESTAMA|INVESTINDO|CAPITAL|KAPITAL|ASSET MANAGEMENT|FUND|TRUST|BANK|SEKURITAS|SECURITIES|GROUP|CORPORA|RESOURCES|NEGARA REPUBLIK INDONESIA|DANA PENSIUN|ASURANSI|REKSA DANA|YAYASAN|KOPERASI)\b/;

const collapse = (name: string) => name.toUpperCase().replace(/\s+/g, " ").trim();

export function holderKind(name: string, badges: string[]): HolderKind {
  const upper = collapse(name);
  if (NOMINEE_PATTERNS.some((pattern) => pattern.test(upper))) return "nominee";
  if (badges.includes("DIREKTUR") || badges.includes("KOMISARIS")) return "person";
  if (ORG_HINT.test(upper)) return "organization";
  return "unknown";
}

/** Organisation key: upper-case, punctuation stripped, legal-form tokens removed. */
export function organizationKey(name: string): string {
  return collapse(name).replace(/[.,()"'’]/g, " ").replace(LEGAL_FORM, " ").replace(/\s+/g, " ").trim();
}

const kindRank: Record<HolderKind, number> = { nominee: 3, organization: 2, person: 1, unknown: 0 };

export function groupInsidersByHolder(rows: InsiderRow[]): HolderGroup[] {
  // Classify each disclosed name once, using every badge seen for it: a name is a person if any row carries a person role.
  const badgesByName = new Map<string, Set<string>>();
  for (const row of rows) {
    const name = collapse(row.person);
    const set = badgesByName.get(name) ?? new Set<string>();
    for (const badge of row.roles) set.add(badge.toUpperCase());
    badgesByName.set(name, set);
  }
  const kindOf = new Map([...badgesByName].map(([name, badges]) => [name, holderKind(name, [...badges])]));

  const groups = new Map<string, { kind: HolderKind; rows: InsiderRow[] }>();
  for (const row of rows) {
    const name = collapse(row.person);
    const kind = kindOf.get(name)!;
    const key = kind === "organization" || kind === "nominee" ? `org:${organizationKey(name) || name}` : `name:${name}`;
    const group = groups.get(key) ?? { kind, rows: [] };
    if (kindRank[kind] > kindRank[group.kind]) group.kind = kind;
    group.rows.push(row);
    groups.set(key, group);
  }

  const result: HolderGroup[] = [...groups].map(([key, { kind, rows: events }]) => {
    const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date));
    const latestDate = sorted[0].date;
    const sameDay = sorted.filter((row) => row.date === latestDate);
    const holdings: HolderHolding[] = [];
    for (const row of sameDay) {
      if (!holdings.some((h) => h.shares === row.currentShares && h.percent === row.currentPercent)) holdings.push({ shares: row.currentShares, percent: row.currentPercent });
    }
    const badges = [...new Set(sorted.flatMap((row) => row.roles.map((badge) => badge.toUpperCase())))];
    return {
      key,
      kind,
      names: [...new Set(sorted.map((row) => row.person.trim()))],
      roles: [...new Set(badges.flatMap((badge) => (ROLE_BADGES[badge] ? [ROLE_BADGES[badge]] : [])))],
      otherBadges: badges.filter((badge) => !ROLE_BADGES[badge]),
      identityUnverified: kind === "person" || kind === "unknown",
      latest: { date: latestDate, holdings, ambiguous: holdings.length > 1 },
      firstDate: sorted.at(-1)!.date,
      events: sorted,
      possiblySameAs: [],
    };
  });

  // Truncated organisation names ("OMUDAS INVESTMENT HOL" vs "…HOLDCO") are flagged, never merged.
  const orgs = result.filter((group) => group.key.startsWith("org:"));
  for (const a of orgs) {
    const ka = a.key.slice(4);
    for (const b of orgs) {
      const kb = b.key.slice(4);
      if (a !== b && ka.length >= 12 && kb.length > ka.length && kb.startsWith(ka)) {
        a.possiblySameAs.push(b.names[0]);
        b.possiblySameAs.push(a.names[0]);
      }
    }
  }

  return result.sort((a, b) => b.latest.date.localeCompare(a.latest.date) || a.names[0].localeCompare(b.names[0]));
}
