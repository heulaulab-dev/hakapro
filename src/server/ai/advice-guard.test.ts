import { describe, expect, test } from "vitest";
import { adviceWording, asksForAdvice } from "./advice-guard";

describe("asksForAdvice", () => {
  test.each([
    "BBCA harus beli sekarang?",
    "Apakah saya jual BBRI?",
    "Kapan waktu yang tepat untuk beli TLKM?",
    "Target harga BBCA berapa?",
    "tpnya berapa bang",
    "Rekomendasikan saham untuk dibeli",
    "Saham apa yang bagus minggu ini?",
    "Prediksi harga ASII bulan depan",
    "Besok BBCA naik?",
    "Should I buy BBCA?",
    "Is it a good time to sell GOTO?",
    "Which stocks should I buy?",
    "Will the price go up tomorrow?",
  ])("refuses %s", (question) => expect(asksForAdvice(question)).toBe(true));

  test.each([
    "Berapa harga terakhir BBCA?",
    "Siapa broker dengan beli bersih terbesar di BBRI?",
    "Ada transaksi orang dalam di TLKM bulan ini?",
    "Sektor apa yang naik paling banyak hari ini?",
    "What does net foreign buying mean?",
    "Show me the research brief for ASII",
  ])("answers %s", (question) => expect(asksForAdvice(question)).toBe(false));
});

describe("adviceWording", () => {
  test.each([
    "Kami merekomendasikan BBCA.",
    "Saham ini layak dibeli.",
    "Sebaiknya jual sekarang.",
    "Target harga Rp10.000.",
    "Ini sinyal beli yang kuat.",
    "BBCA sedang akumulasi oleh asing, fase akumulasi.",
    "Harga diperkirakan naik.",
    "This is a strong buy.",
    "You should buy before earnings.",
    "The stock is undervalued.",
    "The price is likely to rise.",
  ])("rejects %s", (text) => expect(adviceWording(text)).not.toBeNull());

  test.each([
    "Investor asing mencatat beli bersih Rp2,1 T dalam 30 hari.",
    "Foreign investors were net buyers of 1.2M shares.",
    "Harga naik 3,21% dalam 5 sesi.",
    "Orang dalam melaporkan 3 transaksi jual.",
    "Data KSEI tidak tersedia, sehingga kepemilikan tidak dapat dinilai.",
  ])("allows %s", (text) => expect(adviceWording(text)).toBeNull());
});
