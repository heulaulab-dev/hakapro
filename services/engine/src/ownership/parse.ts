// Parsing pipeline: bytes → format parser (PDF / CSV / XLSX) → RawTable → normalizeTable → snapshot rows per issuer.
import { normalizeTable, type NormalizedFile, type ParseContext } from "./normalize";
import { pdfParser } from "./pdf";
import type { OwnershipFileParser, OwnershipFormat, RawTable } from "./raw-table";
import { csvParser, xlsxParser } from "./tabular";

export const PARSERS: Record<OwnershipFormat, OwnershipFileParser> = { pdf: pdfParser, csv: csvParser, xlsx: xlsxParser };

/** Parser version, stored with each upload so a re-parse after a layout change is traceable. Bump on any layout.ts change. */
export const OWNERSHIP_PARSER_VERSION = "ksei-1pct-layout@0.1";

export type ParsedOwnershipFile = NormalizedFile & { columns: RawTable["columns"]; pages: number | null };

/** Throws OwnershipFileError for a file-level failure; row problems are in `issues`. */
export async function parseOwnershipFile(bytes: Uint8Array, format: OwnershipFormat, ctx: ParseContext): Promise<ParsedOwnershipFile> {
  const table = await PARSERS[format].read(bytes);
  return { ...normalizeTable(table, ctx), columns: table.columns, pages: table.pages };
}
