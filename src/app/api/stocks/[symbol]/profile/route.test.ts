import { describe, expect, test, vi } from "vitest";
import { IdxBeiSource } from "@/server/market/idx-bei-source";
import { ProviderBackoff } from "@/server/providers/backoff";

// Fake test values shaped like real identifiers (NPWP 15/16 digits, NIK 16 digits). Not real numbers.
const NPWP = "01.234.567.8-901.000";
const NPWP16 = "0123456789012345";
const NIK = "3171000000000001";

/** An upstream payload that (hypothetically) leaks tax/ID numbers into the records and the top level. */
const upstream = {
  data: {
    symbol: "CBRE", companyName: "Contoh Tbk", website: "https://example.test", description: "Usaha contoh",
    npwp: NPWP, NPKP: NPWP16,
    directors: [{ Nama: "Direktur Contoh", Jabatan: "PRESIDEN DIREKTUR", Afiliasi: true, NIK }],
    commissioners: [{ Nama: "Komisaris Contoh", Jabatan: "KOMISARIS UTAMA", Independen: false, KTP: NIK }],
    shareholders: [
      { Nama: "PT Contoh Holdco", Kategori: "Lebih dari 5%", Jumlah: 2774000000, Persentase: 61.13, Pengendali: true, NPWP, id: 77, DataID: 88 },
      { Nama: "Masyarakat Non Warkat", Kategori: "Masyarakat Non Warkat", Jumlah: 1021067367, Persentase: 22.5, Pengendali: false, Keterangan: NPWP16 },
    ],
    subsidiaries: [{ Nama: "PT Anak Contoh", Persentase: 90, nested: { Npwp_Perusahaan: NPWP } }],
  },
  meta: { source: "idx-bei/companyDetailsByKodeEmiten.json", fetchedAt: "2026-10-03T03:00:00Z", dataAsOf: null, freshness: "UNAVAILABLE" },
};

const source = new IdxBeiSource("http://market.test", undefined, (async () => Response.json(upstream)) as unknown as typeof fetch, new ProviderBackoff());
vi.mock("@/server/auth", () => ({ checkAccess: async () => "allow" }));
vi.mock("@/server/market", async (importOriginal) => ({ ...(await importOriginal<object>()), getMarketDataSource: () => source }));

describe("GET /api/stocks/[symbol]/profile", () => {
  test("tax and ID numbers never reach the API response; disclosed fields do", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/stocks/CBRE/profile"), { params: Promise.resolve({ symbol: "CBRE" }) });
    expect(response.status).toBe(200);
    const text = await response.text();
    for (const leaked of [NPWP, NPWP16, NIK, "01234567890", "NPWP", "NPKP", "Npwp", "NIK", "KTP", "DataID", '"id"']) expect(text).not.toContain(leaked);
    const body = JSON.parse(text);
    expect(body.data.shareholders[0]).toEqual({ Nama: "PT Contoh Holdco", Kategori: "Lebih dari 5%", Jumlah: 2774000000, Persentase: 61.13, Pengendali: true });
    expect(body.data.directors[0]).toEqual({ Nama: "Direktur Contoh", Jabatan: "PRESIDEN DIREKTUR", Afiliasi: true });
    // Undated snapshot: no data date, labelled with retrieval time and dataset instead.
    expect(body.asOf).toBeNull();
    expect(body.freshness).toBe("UNAVAILABLE");
    expect(body.data.dataset).toBe("idx-bei/companyDetailsByKodeEmiten.json");
    expect(Number.isNaN(Date.parse(body.data.retrievedAt))).toBe(false);
  });
});
