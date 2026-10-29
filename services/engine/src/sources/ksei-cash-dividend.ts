import { extractText } from "unpdf";

export type KseiDividendNotice = {
  noticeId: string;
  supersedesNoticeId: string | null;
  symbol: string | null;
  issuer: string | null;
  amountPerShare: number | null;
  cumDate: string | null;
  exDate: string | null;
  recordDate: string | null;
  paymentDate: string | null;
  status: "CONFIRMED" | "REVISION" | "POSTPONEMENT" | "CANCELLED" | "INFORMATIONAL";
  noticeDate: string | null;
  documentUrl: string;
};

const KSEI_PDF_HOST = "web.ksei.co.id";
const NOTICE = /KSEI-\d{3,6}\/[A-Z]+\/\d{4}/i;
const TICKER = /\(([A-Z0-9]{1,8})\)/;
const MONTHS: Record<string, string> = { januari:"01", februari:"02", maret:"03", april:"04", mei:"05", juni:"06", juli:"07", agustus:"08", september:"09", oktober:"10", november:"11", desember:"12" };

function dateFrom(text: string): string | null {
  const match = text.toLocaleLowerCase("id").match(/\b(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(20\d{2})\b/);
  if (!match) return null;
  const date = `${match[3]}-${MONTHS[match[2]]}-${match[1].padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return parsed.toISOString().slice(0, 10) === date ? date : null;
}

function labelledDate(text: string, label: RegExp, previousLines = 0, preferLast = false): string | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (label.test(lines[i])) {
      const dates = (value: string) => [...value.matchAll(/\b\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+20\d{2}\b/gi)].map((match) => dateFrom(match[0])).filter((date): date is string => date !== null);
      const inLine = dates(lines[i]);
      if (inLine.length) return inLine[preferLast ? inLine.length - 1 : 0];
      const candidateNext = lines[i + 1] ?? "";
      const nextLine = /^\s*(?:no\.?|nomor\s*:)/i.test(candidateNext) ? [] : dates(candidateNext);
      if (nextLine.length) return nextLine[preferLast ? nextLine.length - 1 : 0];
      for (let distance = 1; distance <= previousLines; distance++) {
        const before = dateFrom(lines[i - distance] ?? "");
        if (before) return before;
      }
    }
  }
  return null;
}

function indonesianAmount(value: string): number | null {
  let normalized = value.replace(/\s/g, "");
  if (normalized.includes(",")) normalized = normalized.replace(/\./g, "").replace(",", ".");
  else if ((normalized.match(/\./g) ?? []).length > 1 || /^\d{1,3}(?:\.\d{3})+$/.test(normalized)) normalized = normalized.replace(/\./g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

/** Parse official KSEI circulars and amendments. Unknown/partial circulars are rejected rather than guessed. */
export function parseKseiCashDividendText(text: string, documentUrl: string): KseiDividendNotice {
  const url = new URL(documentUrl);
  if (url.protocol !== "https:" || url.hostname !== KSEI_PDF_HOST || !url.pathname.startsWith("/Announcement/Files/") || !url.pathname.toLowerCase().endsWith(".pdf")) {
    throw new Error("KSEI dividend source must be an official KSEI announcement PDF");
  }
  const noticeId = text.match(NOTICE)?.[0]?.toUpperCase();
  if (!noticeId) throw new Error("KSEI notice number not found");

  const heading = text.match(/(?:Perihal\s*:\s*)?[^\n]*(?:dividen|dividen tunai)[^\n]*\(([A-Z0-9]{1,8})\)/i)?.[0] ?? text.match(/\([^\n]*\)/)?.[0] ?? "";
  const listedShare = text.match(/Kode\s+dan\s+Nama\s+Saham\s*:?\s*([A-Z0-9]{1,8})\s*,\s*([^\n]+)/i);
  const symbol = heading.match(TICKER)?.[1] ?? listedShare?.[1] ?? null;
  const issuer = text.match(/(?:efek|saham)\s+([^\n(]+)\s*\(([A-Z0-9]{1,8})\)/i)?.[1]?.trim() ?? listedShare?.[2]?.trim() ?? null;
  const lower = text.toLocaleLowerCase("id");
  const isRevision = /revisi|perubahan jadwal/.test(lower);
  const isPostponement = /penundaan|ditunda/.test(lower);
  const isCancelled = /pembatalan|dibatalkan/.test(lower);
  const status: KseiDividendNotice["status"] = isCancelled ? "CANCELLED" : isPostponement ? "POSTPONEMENT" : isRevision ? "REVISION" : /jadwal pelaksanaan pembagian devi?den/.test(lower) ? "CONFIRMED" : "INFORMATIONAL";
  const supersedesNoticeId = text.match(/(?:pengumuman\s+)?KSEI\s+No\.?\s*:?\s*(KSEI-\d{3,6}\/[A-Z]+\/\d{4})/i)?.[1]?.toUpperCase() ?? null;
  const amount = text.match(/dividen(?:\s+interim|\s+tunai)?\s+sebesar\s+Rp\.?\s*([\d.,]+)/i)?.[1];
  const revisedSection = isRevision ? text.split(/diubah\s+menjadi\s*:/i)[1] : undefined;
  const revisedAmount = revisedSection?.match(/Rp\.?\s*([\d.,]+)/i)?.[1]
    ?? (isRevision ? text.match(/(?:dividen|jumlah|nilai)[^\n]*Rp\.?\s*([\d.,]+)[^\n]*Rp\.?\s*([\d.,]+)/i)?.[2] : undefined);
  const amountPerShare = revisedAmount ? indonesianAmount(revisedAmount) : amount ? indonesianAmount(amount) : null;
  const noticeLine = text.split(/\r?\n/).find((line) => line.includes(noticeId));
  const noticeDate = noticeLine?.match(/(\d{1,2}\s+[A-Za-z]+\s+20\d{2})/)?.[1];

  // An amendment table states the changed field explicitly; all unmentioned fields are intentionally null and are
  // resolved by the importer from the prior notice in its chain, never copied speculatively by this parser.
  const revised = status === "REVISION";
  const cumDate = labelledDate(text, /tanggal\s+cum\s+dividen\s+di\s+pasar\s+reguler/i, 0, revised);
  const exDate = labelledDate(text, /tanggal\s+ex\s+dividen\s+di\s+pasar\s+regul(?:er|ar)/i, 0, revised);
  const recordDate = labelledDate(text, /tanggal\s+pencatatan|recording\s+date/i, 0, revised);
  const paymentDate = labelledDate(text, /tanggal\s+pembayaran\s+dividen/i, 3, revised);
  const revisedValue = text.match(/Tanggal\s+Pembayaran\s+Dividen[^\n]*\n?[^\n]*?(\d{1,2}\s+[A-Za-z]+\s+20\d{2})\s+(\d{1,2}\s+[A-Za-z]+\s+20\d{2})/i);
  const effectivePaymentDate = revisedValue ? dateFrom(revisedValue[2]) : paymentDate;

  if (!symbol && status !== "INFORMATIONAL") throw new Error("KSEI dividend ticker not found");
  if (status === "CONFIRMED" && (!cumDate || !exDate || !recordDate || !effectivePaymentDate || amountPerShare === null)) {
    throw new Error("KSEI dividend circular is missing one or more required fields");
  }
  if (status === "REVISION" && !supersedesNoticeId) throw new Error("KSEI revision does not identify the notice it supersedes");
  return { noticeId, supersedesNoticeId, symbol, issuer, amountPerShare, cumDate, exDate, recordDate, paymentDate: effectivePaymentDate, status, noticeDate: dateFrom(noticeDate ?? ""), documentUrl: url.toString() };
}

export async function parseKseiCashDividendPdf(bytes: Uint8Array, documentUrl: string): Promise<KseiDividendNotice> {
  if (bytes.byteLength < 100 || bytes.byteLength > 8_000_000 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new Error("Expected a KSEI PDF between 100 bytes and 8 MB");
  }
  const { text } = await extractText(bytes.slice());
  return parseKseiCashDividendText(Array.isArray(text) ? text.join("\n") : text, documentUrl);
}

/** Read only PDF links in KSEI's cash-dividend schedule table. We avoid unrelated announcement links. */
export function parseKseiCashDividendSchedule(html: string): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = match[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
    if (!/dividen/i.test(row)) continue;
    for (const link of match[1].matchAll(/href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi)) {
      const url = new URL(link[1], "https://web.ksei.co.id");
      if (url.protocol === "https:" && url.hostname === KSEI_PDF_HOST && url.pathname.startsWith("/Announcement/Files/")) links.add(url.toString());
    }
  }
  return [...links];
}
