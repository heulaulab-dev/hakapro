// Types and checks for the curated conglomerate catalog (groups.ts). The catalog is data, not derived: see groups.ts.

export type GroupConfidence = "sourced" | "unverified";
export type GroupSource = { label: string; url: string };
export type GroupMember = {
  symbol: string;
  /** Overrides the group's confidence for this member (a link the curator could not confirm). */
  confidence?: GroupConfidence;
  /** Why the member is listed, or what about it is uncertain (joint control, a subsidiary of another member...). */
  note?: string;
};
export type GroupDefinition = {
  id: string;
  name: { id: string; en: string };
  confidence: GroupConfidence;
  members: GroupMember[];
  /** Public references for the membership: company annual reports / IR pages, IDX pages, reputable press. */
  sources: GroupSource[];
  /** When the curator last checked this group against its sources (YYYY-MM-DD). */
  reviewedAt: string;
  note?: string;
};
export type GroupCatalog = { version: string; reviewedAt: string; groups: GroupDefinition[] };

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const SYMBOL = /^[A-Z0-9]{1,12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Structural problems in a catalog (empty when it is well-formed). Membership accuracy is the owner's review, not this. */
export function catalogProblems(catalog: GroupCatalog): string[] {
  const problems: string[] = [];
  if (!DATE.test(catalog.reviewedAt)) problems.push(`catalog reviewedAt ${catalog.reviewedAt} is not YYYY-MM-DD`);
  const ids = new Set<string>();
  for (const group of catalog.groups) {
    const at = `group ${group.id}`;
    if (!ID.test(group.id)) problems.push(`${at}: id must be lowercase kebab-case`);
    if (ids.has(group.id)) problems.push(`${at}: duplicate id`);
    ids.add(group.id);
    if (!group.name.id.trim() || !group.name.en.trim()) problems.push(`${at}: name needs id and en`);
    if (!DATE.test(group.reviewedAt)) problems.push(`${at}: reviewedAt is not YYYY-MM-DD`);
    if (!group.members.length) problems.push(`${at}: no members`);
    if (!group.sources.length) problems.push(`${at}: no sources`);
    for (const source of group.sources) {
      if (!source.label.trim()) problems.push(`${at}: a source has no label`);
      let url: URL | null = null;
      try { url = new URL(source.url); } catch { /* reported below */ }
      if (!url || url.protocol !== "https:") problems.push(`${at}: source ${source.url} is not an https URL`);
    }
    const seen = new Set<string>();
    for (const member of group.members) {
      if (!SYMBOL.test(member.symbol)) problems.push(`${at}: member ${member.symbol} is not an IDX code`);
      if (seen.has(member.symbol)) problems.push(`${at}: member ${member.symbol} listed twice`);
      seen.add(member.symbol);
    }
  }
  return problems;
}
