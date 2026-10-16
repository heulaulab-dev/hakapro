// The parser interface: every file format (PDF, CSV, XLSX) is read into the same RawTable of header-mapped text cells.
// normalize.ts turns a RawTable into validated HAKA-33 snapshot rows, so formats differ only in how cells are found.
import type { OwnershipField } from "./layout";

export const OWNERSHIP_FORMATS = ["pdf", "csv", "xlsx"] as const;
export type OwnershipFormat = (typeof OWNERSHIP_FORMATS)[number];

/** A validation problem tied to a place in the file. Errors drop the row; warnings keep it. Never fatal on their own. */
export type ParseIssue = { severity: "error" | "warning"; locator: string; field?: OwnershipField; message: string; text?: string };

export type RawRecord = {
  /** Where the line is: "p3.l12" (PDF page 3, line 12) or "r12" (CSV/XLSX row 12). Becomes the row's source reference. */
  locator: string;
  cells: Partial<Record<OwnershipField, string>>;
  /** The whole line as read, for error messages. */
  text: string;
};

export type RawTable = {
  records: RawRecord[];
  /** Position date printed in a title line, when one was found (raw text). */
  titleDate: string | null;
  /** Header labels found, in column order, with the field each maps to (null = column not used). */
  columns: Array<{ label: string; field: OwnershipField | null }>;
  issues: ParseIssue[];
  pages: number | null;
};

/** Thrown when a file can't be read as a table at all (no header, corrupt file). The upload is marked FAILED. */
export class OwnershipFileError extends Error {
  readonly issues: ParseIssue[];
  constructor(message: string, issues: ParseIssue[] = []) {
    super(message);
    this.issues = issues;
  }
}

export interface OwnershipFileParser {
  readonly format: OwnershipFormat;
  read(bytes: Uint8Array): Promise<RawTable>;
}

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((byte, index) => bytes[index] === byte);

/**
 * File format from its bytes (magic numbers first), with the content type and file name as hints for text files.
 * Null when the file is none of PDF, XLSX or CSV.
 */
export function detectFormat(bytes: Uint8Array, contentType: string | null, fileName: string | null): OwnershipFormat | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "xlsx"; // ZIP container (Office Open XML)
  const type = (contentType ?? "").toLowerCase();
  const name = (fileName ?? "").toLowerCase();
  const looksText = bytes.length > 0 && !bytes.subarray(0, 4096).includes(0);
  if (looksText && (type.includes("csv") || type.startsWith("text/") || name.endsWith(".csv") || type === "" || type === "application/octet-stream")) return "csv";
  return null;
}

export const CONTENT_TYPES: Record<OwnershipFormat, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
