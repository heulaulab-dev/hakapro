// Data Engine ownership contract (E6, Plane HAKA-66): the monthly KSEI ≥1% list the owner uploads, served as HAKA-33
// snapshot lines and month-over-month changes. Shared by the engine (validates every response) and the app.
// Share counts are integer strings and percentages six-decimal strings (src/lib/ownership/decimal.ts); no floats.
import { z } from "zod";
import { OWNERSHIP_CHANGE_FLAGS, OWNERSHIP_CHANGE_KINDS } from "@/lib/ownership/changes";
import { OWNERSHIP_HOLDER_KINDS } from "@/lib/ownership/snapshot";
import { symbolSchema } from "./inputs";
import { ownershipNetworkSchema } from "./market-intelligence";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const ownershipMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const shares = z.string().regex(/^\d{1,24}$/).nullable();
const signedShares = z.string().regex(/^-?\d{1,25}$/).nullable();
const percent = z.string().regex(/^\d{1,3}\.\d{6}$/).nullable();
const pp = z.string().regex(/^-?\d{1,3}\.\d{6}$/).nullable();

/** Where a snapshot came from: the dataset, the owner's label for the file, and when HAKAPRO read it. */
export const ownershipSourceRefSchema = z.object({
  dataset: z.string(),
  /** Set-level reference: the owner's label (e.g. the IDX announcement number) or the upload id and file name. */
  reference: z.string(),
  retrievedAt: z.string(),
  uploadId: z.string(),
});

/** One disclosed line, verbatim (name as published; kind and key from the HAKA-33 policy). */
export const ownershipHolderLineSchema = z.object({
  holderKey: z.string(),
  holderName: z.string(),
  holderKind: z.enum(OWNERSHIP_HOLDER_KINDS),
  shares,
  percent,
  /** As stated by the source (KSEI codes such as CP, ID, MF); null when not stated. */
  investorType: z.string().nullable(),
  localForeign: z.string().nullable(),
  /** Line locator inside the uploaded file, e.g. "upload:<id>#p3.l12". */
  reference: z.string(),
});

export const ownershipCrossHoldingSchema = z.object({
  ownerSymbol: symbolSchema,
  ownerName: z.string(),
  heldSymbol: symbolSchema,
  heldName: z.string(),
  shares,
  percent,
  reciprocalShares: shares,
  reciprocalPercent: percent,
  snapshotDate: isoDate,
  sourceReference: z.string(),
  reciprocalSourceReference: z.string(),
});

export const OWNERSHIP_COMPARISON_STATUSES = ["COMPARED", "NO_PREVIOUS", "NOT_ADJACENT", "REFUSED"] as const;
export const ownershipComparisonSchema = z.object({
  /** COMPARED with the previous month; NO_PREVIOUS (first month stored); NOT_ADJACENT (a month is missing, not compared). */
  status: z.enum(OWNERSHIP_COMPARISON_STATUSES),
  fromMonth: ownershipMonthSchema.nullable(),
  fromDate: isoDate.nullable(),
  toDate: isoDate,
  counts: z.record(z.enum(OWNERSHIP_CHANGE_KINDS), z.number().int().nonnegative()).nullable(),
  issuedShares: z.object({ before: z.string(), after: z.string(), delta: z.string() }).nullable(),
  detail: z.string().nullable(),
});

/**
 * HAKA-34 estimate, methodology DRAFT (FREE-FLOAT-METHODOLOGY.md). Never official. The engine serves it only with
 * ENGINE_FREE_FLOAT_ENABLED=1, and even then a UI must label it "Estimated free float (HAKAPRO methodology v0.1)".
 */
export const freeFloatDraftSchema = z.object({
  methodologyStatus: z.literal("draft"),
  figureType: z.literal("ESTIMATE"),
  isOfficial: z.literal(false),
  methodology: z.object({ id: z.string(), version: z.string(), status: z.string(), label: z.string() }),
  asOf: isoDate,
  thresholdPercent: z.string(),
  estimate: z.object({ headline: z.string(), low: z.string(), high: z.string() }).nullable(),
  totals: z.object({ disclosed: z.string(), strategic: z.string(), portfolio: z.string(), unknown: z.string(), undisclosed: z.string() }).nullable(),
  unavailableReason: z.string().nullable(),
  caveats: z.array(z.string()),
  holders: z.array(z.object({ holderKey: z.string(), holderName: z.string(), percent: z.string().nullable(), holderClass: z.string(), rule: z.string() })),
});

/** `/v1/stocks/{s}/ownership`: the newest stored month for the symbol. Empty form (nulls, no holders) when none. */
export const stockOwnershipSchema = z.object({
  symbol: symbolSchema,
  issuerName: z.string().nullable(),
  month: ownershipMonthSchema.nullable(),
  /** Position date of the list (the as-of), not the upload date. */
  snapshotDate: isoDate.nullable(),
  /** "1.000000" for the ≥1% list: holders below it are not disclosed, which is not the same as zero. */
  thresholdPercent: percent,
  issuedShares: shares,
  source: ownershipSourceRefSchema.nullable(),
  holders: z.array(ownershipHolderLineSchema),
  /** Verified listed-company-to-listed-company edges inferred only when a KSEI holder matches an issuer name. */
  crossHoldings: z.array(ownershipCrossHoldingSchema),
  network: ownershipNetworkSchema.nullable(),
  comparison: ownershipComparisonSchema.nullable(),
  freeFloat: freeFloatDraftSchema.nullable(),
});

export const ownershipChangeSchema = z.object({
  symbol: symbolSchema,
  holderKey: z.string(),
  holderName: z.string(),
  holderKind: z.enum(OWNERSHIP_HOLDER_KINDS),
  kind: z.enum(OWNERSHIP_CHANGE_KINDS),
  sharesBefore: shares,
  sharesAfter: shares,
  shareDelta: signedShares,
  percentBefore: percent,
  percentAfter: percent,
  ppDelta: pp,
  flags: z.array(z.enum(OWNERSHIP_CHANGE_FLAGS)),
  fromDate: isoDate,
  toDate: isoDate,
  fromReferences: z.array(z.string()),
  toReferences: z.array(z.string()),
});

/** `/v1/ownership/changes?month=YYYY-MM[&symbol=]`: changes into `month` from the previous month, per holder. */
export const ownershipChangesSchema = z.object({
  month: ownershipMonthSchema,
  previousMonth: ownershipMonthSchema,
  comparisons: z.array(ownershipComparisonSchema.extend({ symbol: symbolSchema })),
  changes: z.array(ownershipChangeSchema),
});

/** Market-wide disclosed ≥1% positions; counts describe published rows, not all beneficial owners or free float. */
export const ownershipScreenerSchema = z.object({
  month: ownershipMonthSchema,
  snapshotDate: isoDate,
  issuers: z.number().int().nonnegative(),
  investors: z.number().int().nonnegative(),
  holdings: z.number().int().nonnegative(),
  localForeign: z.object({ local: z.number().int().nonnegative(), foreign: z.number().int().nonnegative(), unknown: z.number().int().nonnegative() }),
  classifications: z.array(z.object({ name: z.string(), holdings: z.number().int().nonnegative() })),
  rows: z.array(z.object({ symbol: symbolSchema, issuerName: z.string().nullable(), holderName: z.string(), holderKind: z.enum(OWNERSHIP_HOLDER_KINDS), investorType: z.string().nullable(), localForeign: z.string().nullable(), shares, percent })),
});

export const ownershipUploadIssueSchema = z.object({
  severity: z.enum(["error", "warning"]), locator: z.string(), field: z.string().optional(), message: z.string(), text: z.string().optional(),
});

/** Admin `/v1/admin/ownership/uploads`: one uploaded file and what parsing made of it. */
export const ownershipUploadSchema = z.object({
  id: z.string(),
  receivedAt: z.string(),
  asOfMonth: ownershipMonthSchema,
  snapshotDate: isoDate.nullable(),
  sourceLabel: z.string().nullable(),
  fileName: z.string().nullable(),
  format: z.enum(["pdf", "csv", "xlsx"]),
  contentType: z.string(),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string(),
  status: z.enum(["RECEIVED", "PARSED", "FAILED"]),
  error: z.string().nullable(),
  issues: z.array(ownershipUploadIssueSchema),
  stats: z.record(z.string(), z.unknown()).nullable(),
  parsedAt: z.string().nullable(),
});

export type StockOwnership = z.infer<typeof stockOwnershipSchema>;
export type OwnershipChanges = z.infer<typeof ownershipChangesSchema>;
export type OwnershipScreener = z.infer<typeof ownershipScreenerSchema>;
export type OwnershipUpload = z.infer<typeof ownershipUploadSchema>;
