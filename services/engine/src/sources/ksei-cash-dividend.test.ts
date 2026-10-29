import { describe, expect, it } from "vitest";
import { parseKseiCashDividendSchedule, parseKseiCashDividendText } from "./ksei-cash-dividend";

const regular = `Jadwal Pelaksanaan Pembagian Deviden Interim atas Efek PURADELTA LESTARI Tbk (DMAS).
Tanggal Cum Dividen di Pasar Reguler & Pasar Negosiasi 28 Oktober 2026
Tanggal Ex Dividen di Pasar Regular & Pasar Negosiasi 29 Oktober 2026
Tanggal Cum Dividen di Pasar Tunai 30 Oktober 2026
Tanggal Pencatatan (Recording Date) 30 Oktober 2026
Tanggal Ex Dividen di Pasar Tunai 2 November 2026
Tanggal Pembayaran Dividen Tunai 13 November 2026
No : KSEI-26328/JKU/1026 Jakarta, 21 Oktober 2026
Setiap 1 (Satu) saham akan mendapatkan dividen Interim sebesar Rp.29 (Dua Puluh Sembilan Rupiah)
Kode dan Nama Saham : DMAS, PURADELTA LESTARI Tbk`;
const url = "https://web.ksei.co.id/Announcement/Files/DMAS_DIV_20261030_ID.pdf";

describe("KSEI cash dividend circular parser", () => {
  it("parses official schedule fields and canonicalizes Indonesian dates", () => {
    expect(parseKseiCashDividendText(regular, url)).toMatchObject({
      noticeId: "KSEI-26328/JKU/1026", symbol: "DMAS", amountPerShare: 29,
      cumDate: "2026-10-28", exDate: "2026-10-29", recordDate: "2026-10-30", paymentDate: "2026-11-13",
      status: "CONFIRMED", noticeDate: "2026-10-21",
    });
  });

  it("captures a payment-date amendment as a separate notice linked to its predecessor", () => {
    const amendment = `Perihal : Revisi Jadwal Dividen Interim atas efek PURADELTA LESTARI Tbk (DMAS).
Nomor : KSEI-26783/JKU/1026 28 Oktober 2026
Sebagai tindak lanjut Pengumuman KSEI No.: KSEI-26328/JKU/1026 tanggal 21 Oktober 2026
No. Kegiatan Jadwal Semula Diubah menjadi
6. Tanggal Pembayaran Dividen Interim 13 November 2026 16 November 2026`;
    expect(parseKseiCashDividendText(amendment, url)).toMatchObject({
      noticeId: "KSEI-26783/JKU/1026", supersedesNoticeId: "KSEI-26328/JKU/1026", symbol: "DMAS",
      paymentDate: "2026-11-16", status: "REVISION", noticeDate: "2026-10-28",
    });
  });

  it("uses the amended date in a date-change row while preserving other dates via the chain", () => {
    const amendment = `Perihal : Revisi Jadwal Dividen Interim atas efek PURADELTA LESTARI Tbk (DMAS).
Nomor : KSEI-26783/JKU/1026 28 Oktober 2026
Pengumuman KSEI No.: KSEI-26328/JKU/1026 tanggal 21 Oktober 2026
Tanggal Cum Dividen di Pasar Reguler 28 Oktober 2026 29 Oktober 2026`;
    expect(parseKseiCashDividendText(amendment, url)).toMatchObject({ cumDate: "2026-10-29", status: "REVISION" });
  });

  it("takes a revised dividend amount from the changed-to section instead of the previous value", () => {
    const amendment = `Perihal : Revisi Rasio Pembagian Dividen Tunai atas ASTRA OTOPARTS Tbk (AUTO).
Nomor : KSEI-25464/JKU/1026 8 Oktober 2026
Pengumuman KSEI No. KSEI-25249/JKU/1026 tanggal 6 Oktober 2026
Sebelumnya:
Setiap 1 saham akan mendapatkan dividen tunai sebesar Rp.75,52
Diubah menjadi:
Setiap 1 saham akan mendapatkan dividen tunai sebesar Rp.72,52`;
    expect(parseKseiCashDividendText(amendment, url)).toMatchObject({
      symbol: "AUTO", supersedesNoticeId: "KSEI-25249/JKU/1026", amountPerShare: 72.52, status: "REVISION",
    });
  });

  it("parses KSEI's PDF extraction order when table dates appear before their labels", () => {
    const reordered = `Jadwal Pelaksanaan Pembagian Deviden Interim atas Efek PURADELTA LESTARI Tbk (DMAS).
Tanggal Cum Dividen di Pasar Reguler & Pasar Negosiasi 28 Oktober 2026
Tanggal Ex Dividen di Pasar Regular & Pasar Negosiasi 29 Oktober 2026
Tanggal Cum Dividen di Pasar Tunai 30 Oktober 2026
Tanggal Pencatatan (Recording Date) 30 Oktober 2026
13 November 2026
Tanggal Ex Dividen di Pasar Tunai
Tanggal Pembayaran Dividen Tunai
No : KSEI-26328/JKU/1026 Jakarta, 21 Oktober 2026
Setiap 1 (Satu) saham akan mendapatkan dividen Interim sebesar Rp.29 (Dua Puluh Sembilan Rupiah)
Kode dan Nama Saham : DMAS, PURADELTA LESTARI Tbk`;
    expect(parseKseiCashDividendText(reordered, url)).toMatchObject({ paymentDate: "2026-11-13", status: "CONFIRMED" });
  });

  it("rejects lookalike domains and incomplete confirmed notices", () => {
    expect(() => parseKseiCashDividendText(regular, url.replace("web.ksei.co.id", "ksei.co.id.attacker.test"))).toThrow(/official KSEI/);
    expect(() => parseKseiCashDividendText("Jadwal Pelaksanaan Pembagian Deviden atas Emiten (DMAS) KSEI-12345/JKU/1026", url)).toThrow(/required fields/);
  });

  it("extracts only official PDF links from dividend schedule rows", () => {
    const html = `<table><tr><td><a href="/Announcement/Files/DMAS.pdf">KSEI-26328/JKU/1026</a></td><td>Jadwal Dividen Tunai</td></tr><tr><td><a href="https://evil.test/x.pdf">KSEI-2/ABC/2026</a></td><td>Dividen</td></tr><tr><td><a href="/Announcement/Files/right.pdf">Jadwal HMETD</a></td></tr></table>`;
    expect(parseKseiCashDividendSchedule(html)).toEqual(["https://web.ksei.co.id/Announcement/Files/DMAS.pdf"]);
  });
});
