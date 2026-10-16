// Minimal PDF writer for synthetic test fixtures: positioned single-line text in the standard Helvetica fonts, no
// embedded fonts, images or compression. Enough to produce a table PDF whose text pdf.js extracts with positions.
// Test support only; the engine never writes PDFs.

export type PdfText = { x: number; y: number; text: string; size?: number; bold?: boolean; align?: "left" | "right" };
export type PdfPage = PdfText[];

// Helvetica advance widths (1/1000 em) for the glyphs the fixtures right-align; everything else is approximated.
const WIDTHS: Record<string, number> = {
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556,
  ".": 278, ",": 278, "%": 889, "-": 333, " ": 278,
};

/** Approximate Helvetica width of `text` at `size` points (exact for digits and separators). */
export function textWidth(text: string, size: number): number {
  return [...text].reduce((sum, char) => sum + (WIDTHS[char] ?? 611), 0) * size / 1000;
}

const escape = (text: string) => {
  if (/[^\x20-\x7e]/.test(text)) throw new Error(`fixture text must be printable ASCII: ${JSON.stringify(text)}`);
  return text.replace(/[\\()]/g, (char) => `\\${char}`);
};

/** Builds a PDF (landscape A4 by default) with one content stream per page. Deterministic for the same input. */
export function buildPdf(pages: PdfPage[], options: { width?: number; height?: number; title?: string } = {}): Uint8Array {
  const width = options.width ?? 842;
  const height = options.height ?? 595;
  const objects: string[] = [];
  const add = (body: string) => objects.push(body); // returns the 1-based object number

  const catalog = add(""); // filled below once the page tree number is known
  const pageTree = add("");
  const regular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const bold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const info = add(`<< /Title (${escape(options.title ?? "Synthetic fixture")}) /Producer (HAKAPRO engine test pdf-writer) >>`);

  const pageNumbers: number[] = [];
  for (const page of pages) {
    const stream = page.map((item) => {
      const size = item.size ?? 7;
      const x = item.align === "right" ? item.x - textWidth(item.text, size) : item.x;
      return `BT /${item.bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${item.y.toFixed(2)} Tm (${escape(item.text)}) Tj ET`;
    }).join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    pageNumbers.push(add(`<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pageTree} 0 R >>`;
  objects[pageTree - 1] = `<< /Type /Pages /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageNumbers.length} >>`;

  let body = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "latin1"));
}
