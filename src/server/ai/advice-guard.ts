/**
 * Regulatory guard (spec §3.2, §6): HAKAPRO is research and education only. No buy/sell/hold calls, no price
 * targets, no predictions, no verdict labels such as "akumulasi". Two deterministic checks back up the prompts:
 * - `asksForAdvice`: a copilot question asking for a call is answered with a fixed polite refusal, without a
 *   model call (and without charging quota).
 * - `adviceWording`: model output containing advice or verdict wording is rejected like an unverified number.
 * Lists are deliberately phrase-level (not single words such as "beli", which legitimately appears in
 * "beli bersih" / "net buying").
 */

const ADVICE_REQUEST: RegExp[] = [
  /\b(harus|sebaiknya|apakah|layak|bagus|boleh|perlu|mending|enaknya)\s+(saya\s+|aku\s+|gw\s+|gue\s+)?(beli|jual|hold|tahan|masuk|keluar|serok|cut\s*loss|average\s*down|avg\s*down|nyicil)\b/i,
  /\bkapan\s+(waktu\s+(yang\s+)?tepat\s+)?(untuk\s+)?(beli|jual|masuk|keluar|entry|exit)\b/i,
  /\b(target\s+harga|harga\s+target|price\s+target|target\s+price|tp\s*(nya|berapa)|berapa\s+tp)\b/i,
  /\b(rekomendasi(kan)?|rekomen)\b.*\b(saham|beli|jual|emiten)\b/i,
  /\bsaham\s+apa\s+(yang\s+)?(bagus|harus|layak|cocok|potensial|bakal\s+naik)\b/i,
  /\b(prediksi|ramal(an|kan)?)\s+(harga|saham)\b/i,
  /\b(besok|lusa|minggu\s+depan|bulan\s+depan)\b.*\b(naik|turun|ara|arb|terbang|anjlok)\b/i,
  /\bshould\s+i\s+(buy|sell|hold|short|exit|enter|average\s+down)\b/i,
  /\bis\s+(it|now|this)\s+(a\s+)?(good|right|bad)\s+(time|idea|moment)\s+to\s+(buy|sell|invest)\b/i,
  /\b(what|which)\s+stocks?\s+(should|to|do\s+you\s+recommend)\b/i,
  /\brecommend\s+(a\s+|some\s+|me\s+)?(stocks?|buying|selling)\b/i,
  /\bwill\s+(it|the\s+(price|stock))\s+(go\s+up|go\s+down|rise|fall|drop|rally)\b/i,
  /\b(predict|forecast)\s+(the\s+)?(price|stock)\b/i,
];

const ADVICE_OUTPUT: RegExp[] = [
  /\b(rekomendasi|direkomendasikan|merekomendasikan|recommend(s|ed|ation)?)\b/i,
  /\b(sebaiknya|layak|saatnya|waktunya|disarankan)\s+(untuk\s+)?(beli|jual|membeli|menjual|dibeli|dijual|dikoleksi|hold|tahan|menahan)\b/i,
  /\b(target\s+harga|harga\s+target|price\s+target|target\s+price|entry\s+(point|price|area)|titik\s+masuk|stop\s*loss|cut\s*loss|take\s*profit)\b/i,
  /\b(sinyal|signal)\s+(beli|jual|buy|sell)\b|\b(buy|sell)\s+signal\b|\bstrong\s+(buy|sell)\b/i,
  /\b(should|must|ought\s+to)\s+(buy|sell|hold|accumulate)\b/i,
  /\b(good|great|right)\s+time\s+to\s+(buy|sell)\b|\b(undervalued|overvalued|murah\s+banget|kemahalan)\b/i,
  /\b(fase|tahap|sedang)\s+(akumulasi|distribusi)\b|\b(accumulation|distribution)\s+phase\b|\bbeing\s+(accumulated|distributed)\b/i,
  /\b(akan|bakal|diperkirakan|diprediksi)\s+(naik|turun|menguat|melemah)\b|\b(will|is\s+(likely|expected)\s+to)\s+(rise|fall|go\s+up|go\s+down|rally|drop)\b/i,
];

export function asksForAdvice(question: string): boolean {
  return ADVICE_REQUEST.some((pattern) => pattern.test(question));
}

/** The first advice/verdict phrase found in model output, or null. */
export function adviceWording(text: string): string | null {
  for (const pattern of ADVICE_OUTPUT) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return null;
}

export const ADVICE_REFUSAL = {
  id: "Maaf, HAKAPRO hanya untuk riset dan edukasi, jadi saya tidak bisa memberi saran beli, jual atau tahan, target harga, atau prediksi. Saya bisa membantu melihat datanya: harga terakhir, riwayat harga, ringkasan broker, transaksi orang dalam, kinerja sektor, atau Research Brief suatu saham, masing-masing dengan tanggal datanya. Keputusan tetap di tangan Anda.",
  en: "Sorry, HAKAPRO is for research and education only, so I can't give buy, sell or hold advice, price targets, or predictions. I can help you look at the data: the last price, price history, broker summary, insider transactions, sector performance, or a stock's Research Brief, each with its as-of date. The decision stays yours.",
} as const;
