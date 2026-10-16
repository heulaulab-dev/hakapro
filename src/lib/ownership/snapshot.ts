/**
 * Normalised ownership snapshot (Data Engine, CONNECTION-NETWORK.md → "Ownership snapshot type and change engine").
 * One row = one holder line of one dataset for one ticker at one position date. A snapshot = every row for one ticker
 * and one position date, plus the dataset's disclosure threshold.
 *
 * Pure types and validation only: nothing here fetches, parses PDFs or ingests data.
 */
import { z } from "zod";
import { organizationKey } from "@/lib/insider-holders";
import { HUNDRED_PERCENT_MICRO, PERCENT_PATTERN, percentToMicro, SHARES_PATTERN } from "./decimal";

export const OWNERSHIP_HOLDER_KINDS = ["person", "organisation", "custodian_nominee", "government", "public", "unknown"] as const;
export type OwnershipHolderKind = (typeof OWNERSHIP_HOLDER_KINDS)[number];

const TICKER = /^[A-Z0-9]{1,12}$/;
const sharesSchema = z.string().regex(SHARES_PATTERN, "shares must be a non-negative integer string");
export const percentSchema = z
  .string()
  .regex(PERCENT_PATTERN, "percent must be a decimal string with at most 6 decimals")
  .refine((value) => percentToMicro(value) <= HUNDRED_PERCENT_MICRO, "percent must be between 0 and 100");

export const ownershipSourceSchema = z.object({
  /** Dataset identifier, e.g. "ksei-1pct-via-idx". Never a guess: it names where the row was read. */
  dataset: z.string().trim().min(1),
  /** Locator inside the dataset: announcement number, file, page/row. Enough to find the line again. */
  reference: z.string().trim().min(1),
  /** When HAKAPRO read the source. This is not the position date. */
  retrievedAt: z.iso.datetime({ offset: true }),
});
export type OwnershipSource = z.infer<typeof ownershipSourceSchema>;

export const ownershipSnapshotRowSchema = z.object({
  ticker: z.string().regex(TICKER),
  /** Grouping key from `ownershipHolderKey` (or a curated alias). The raw `holderName` is always kept beside it. */
  holderKey: z.string().min(1),
  /** The name exactly as disclosed. */
  holderName: z.string().trim().min(1),
  holderKind: z.enum(OWNERSHIP_HOLDER_KINDS),
  /** Integer share count as a string (`numeric(24,0)`); null when the source states only a percentage. */
  shares: sharesSchema.nullable(),
  /** Percentage of issued shares as a decimal string (`numeric(9,6)`); null when the source states only shares. */
  percent: percentSchema.nullable(),
  /** Position (as-of) date of the holding, e.g. the last trading day of the month. Not the retrieval date. */
  snapshotDate: z.iso.date(),
  source: ownershipSourceSchema,
});
export type OwnershipSnapshotRow = z.infer<typeof ownershipSnapshotRowSchema>;

export const ownershipSnapshotSchema = z
  .object({
    ticker: z.string().regex(TICKER),
    snapshotDate: z.iso.date(),
    /**
     * Disclosure threshold of the dataset, in percent: "1" for the KSEI ≥1% list, "0" for a complete register.
     * A holder missing from a snapshot with a threshold above 0 is *not disclosed*, which is not the same as zero.
     */
    thresholdPercent: percentSchema,
    /** Issued shares at the position date when a source states it; null otherwise. Never derived from rounded percentages. */
    issuedShares: sharesSchema.nullable(),
    rows: z.array(ownershipSnapshotRowSchema),
  })
  .superRefine((snapshot, ctx) => {
    snapshot.rows.forEach((row, index) => {
      if (row.ticker !== snapshot.ticker) ctx.addIssue({ code: "custom", path: ["rows", index, "ticker"], message: `row ticker ${row.ticker} ≠ snapshot ticker ${snapshot.ticker}` });
      if (row.snapshotDate !== snapshot.snapshotDate) ctx.addIssue({ code: "custom", path: ["rows", index, "snapshotDate"], message: `row date ${row.snapshotDate} ≠ snapshot date ${snapshot.snapshotDate}` });
    });
  });
export type OwnershipSnapshot = z.infer<typeof ownershipSnapshotSchema>;

/** Every distinct source of a set of rows, in first-seen order. */
export function distinctSources(rows: OwnershipSnapshotRow[]): OwnershipSource[] {
  const seen = new Map<string, OwnershipSource>();
  for (const row of rows) seen.set(JSON.stringify([row.source.dataset, row.source.reference, row.source.retrievedAt]), row.source);
  return [...seen.values()];
}

const collapse = (name: string) => name.toUpperCase().replace(/\s+/g, " ").trim();

/**
 * Holder key, following the insider grouping policy (src/lib/insider-holders.ts, CONNECTION-NETWORK.md §3):
 * - organisations, custodian/nominee accounts and government holders: `org:` + legal-form-normalised name;
 * - people and unknown types: `name:` + the exact name (case and whitespace aside), no fuzzy or initial matching;
 * - aggregates such as "Masyarakat": `public:` + the exact name.
 * The prefix depends on the organisation-like / person-like family, not the exact kind, so an organisation that a later
 * month labels as government keeps its key.
 */
export function ownershipHolderKey(holderName: string, holderKind: OwnershipHolderKind): string {
  const name = collapse(holderName);
  switch (holderKind) {
    case "organisation":
    case "custodian_nominee":
    case "government":
      return `org:${organizationKey(name) || name}`;
    case "public":
      return `public:${name}`;
    case "person":
    case "unknown":
      return `name:${name}`;
  }
}
