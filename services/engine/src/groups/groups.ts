// Curated conglomerate groups behind /v1/groups ("Rotasi Konglomerat"). VERSIONED DATA, NOT DERIVED: bump `version`
// and the group's `reviewedAt` with every change.
//
// OWNER REVIEW REQUIRED. This first version (2026-10-21) was compiled from public press and company pages found by
// web search (the `sources` of each group); it has not been checked against annual reports or KSEI filings by the
// owner. Control of listed companies changes (rights issues, tender offers, mergers, spin-offs) and tickers get
// renamed or delisted, so:
//   - review every group at least quarterly, and whenever a member announces a change of control;
//   - only list a member when a public source names the link; mark anything you cannot confirm `confidence:
//     "unverified"` (the UI shows it) and say why in `note`; never add members to fill a list;
//   - the engine validates members against its `securities` table on every request and reports unknown, inactive
//     and no-data symbols per group instead of failing (src/serve/groups.ts), so a stale entry shows up on the page.
//
// Deliberately left out (2026-10-21): SILO (CVC took control from Lippo in 2024), NOBU (Hanwha Life controller since
// Jun 2025), LIFE (MSIG Life, Mitsui Sumitomo controls it; SMMA keeps ~12.5%), IATA (now Karya Pacific Energy; MNC
// gave up control in 2026), FREN (merged into XLSMART/EXCL in 2025, jointly held with Axiata), INCO (MIND ID is a
// minority holder).
import type { GroupCatalog } from "./catalog";

const REVIEWED = "2026-10-21";

export const GROUP_CATALOG: GroupCatalog = {
  version: "2026-10-21.1",
  reviewedAt: REVIEWED,
  groups: [
    {
      id: "astra", name: { id: "Grup Astra", en: "Astra Group" }, confidence: "sourced", reviewedAt: REVIEWED,
      note: "Controlled by Jardine Matheson through Jardine Cycle & Carriage.",
      members: [
        { symbol: "ASII" }, { symbol: "AALI" }, { symbol: "UNTR" }, { symbol: "AUTO" }, { symbol: "ASGR" },
        { symbol: "ACST", note: "Controlled through PT Karya Supra Perkasa (United Tractors)." },
      ],
      sources: [
        { label: "Bisnis: Astra group lineup (2023)", url: "https://market.bisnis.com/read/20231101/192/1709994/kinerja-grup-astra-per-kuartal-iii2023-asii-untr-auto-aali-asgr-acst" },
        { label: "Bisnis: Astra injects capital into ACST (2025)", url: "https://market.bisnis.com/read/20250507/192/1875219/grup-astra-suntik-modal-ke-acset-acst-rp500-miliar" },
      ],
    },
    {
      id: "salim", name: { id: "Grup Salim", en: "Salim Group" }, confidence: "sourced", reviewedAt: REVIEWED,
      members: [
        { symbol: "INDF" }, { symbol: "ICBP", note: "Subsidiary of INDF." }, { symbol: "SIMP", note: "Subsidiary of INDF." },
        { symbol: "LSIP", note: "Held through SIMP." }, { symbol: "IMAS" }, { symbol: "IMJS", note: "About 92% held by IMAS." },
        { symbol: "DNET" }, { symbol: "BINA", note: "Salim-controlled since 2020." },
      ],
      sources: [
        { label: "Bisnis: Salim group lineup (2023)", url: "https://market.bisnis.com/read/20230803/192/1680449/kinerja-grup-salim-semester-i2023-indf-icbp-simp-lsip-fast-dnet-roti-imas-bina" },
        { label: "Bisnis: IMAS standby buyer for IMJS rights (2025)", url: "https://market.bisnis.com/read/20250916/192/1911651/emiten-grup-salim-indomobil-imas-jadi-pembeli-siaga-rights-issue-imjs" },
        { label: "Kontan: Salim takes over Bank Ina Perdana", url: "https://keuangan.kontan.co.id/news/resmi-dimiliki-grup-salim-begini-rencana-bisnis-bank-ina-perdana-ke-depan" },
      ],
    },
    {
      id: "sinarmas", name: { id: "Grup Sinar Mas", en: "Sinar Mas Group" }, confidence: "sourced", reviewedAt: REVIEWED,
      note: "Widjaja family.",
      members: [
        { symbol: "DSSA" }, { symbol: "GEMS", confidence: "unverified", note: "DSSA subsidiary; no source seen in this review." },
        { symbol: "SMAR" }, { symbol: "INKP" }, { symbol: "TKIM" }, { symbol: "BSDE" }, { symbol: "DUTI" }, { symbol: "DMAS" },
        { symbol: "SMMA" }, { symbol: "BSIM", note: "Under SMMA." },
        { symbol: "MORA", note: "Controller PT Innovate Mas Utama (DSSA) after the MyRepublic merger (2026)." },
      ],
      sources: [
        { label: "Katadata: Sinar Mas listed companies (Jul 2026)", url: "https://katadata.co.id/amp/finansial/bursa/6a59dc58c785f/sinar-mas-penyumbang-hsc-terbanyak-kepemilikan-5-emiten-terkonsentrasi-tinggi" },
        { label: "Cermati: Sinar Mas group stocks", url: "https://www.cermati.com/artikel/saham-sinarmas-group" },
        { label: "IDNFinancials: Sinar Mas becomes MORA controller", url: "https://www.idnfinancials.com/news/59718/mora-akan-merger-dengan-myrepublic-sinar-mas-jadi-pengendali-baru?sl=en" },
      ],
    },
    {
      id: "djarum", name: { id: "Grup Djarum", en: "Djarum Group" }, confidence: "sourced", reviewedAt: REVIEWED,
      note: "Hartono family.",
      members: [
        { symbol: "BBCA" }, { symbol: "TOWR", note: "Controlled by PT Sapta Adhikari Investama." },
        { symbol: "BELI", note: "Controlled by PT Global Investama Andalan." }, { symbol: "RANC", note: "About 70.6% held through BELI." },
      ],
      sources: [
        { label: "Bisnis: TOWR, a Djarum group company (2025)", url: "https://market.bisnis.com/read/20250106/192/1829053/emiten-grup-djarum-towr-cum-dividen-duo-hartono-raup-rp171-miliar" },
        { label: "Bisnis: Djarum takes Blibli (BELI) public", url: "https://market.bisnis.com/read/20221018/192/1588742/martin-hartono-ungkap-alasan-grup-djarum-bawa-blibli-beli-ipo" },
        { label: "Bisnis: Blibli acquires RANC", url: "https://market.bisnis.com/read/20211001/192/1449242/grup-djarum-blibli-resmi-akuisisi-ranc-siapkan-tender-offer" },
      ],
    },
    {
      id: "barito", name: { id: "Grup Barito (Prajogo Pangestu)", en: "Barito Group (Prajogo Pangestu)" }, confidence: "sourced", reviewedAt: REVIEWED,
      members: [
        { symbol: "BRPT" }, { symbol: "TPIA" }, { symbol: "BREN" }, { symbol: "CUAN" },
        { symbol: "PTRO", note: "Controlled by CUAN (bought from Indika)." }, { symbol: "CDIA", note: "Chandra Asri unit, listed 2025." },
      ],
      sources: [
        { label: "Bisnis: Prajogo Pangestu's listed companies (Sep 2026)", url: "https://market.bisnis.com/read/20260923/192/2006512/daftar-emiten-dalam-jaringan-bisnis-prajogo-pangestu-di-bei" },
        { label: "Katadata: Prajogo companies H1 2026", url: "https://katadata.co.id/finansial/bursa/6a71897a01f6f/adu-kinerja-emiten-prajogo-cuan-bren-brpt-tpia-cdia-semester-i-2026" },
      ],
    },
    {
      id: "bakrie", name: { id: "Grup Bakrie", en: "Bakrie Group" }, confidence: "sourced", reviewedAt: REVIEWED,
      members: [
        { symbol: "BNBR" }, { symbol: "ENRG" }, { symbol: "UNSP" }, { symbol: "DEWA" }, { symbol: "ELTY" }, { symbol: "VKTR" },
        { symbol: "BUMI", confidence: "unverified", note: "Joint Bakrie–Salim: Mach Energy holds ~45.8%; ultimate owners named as Anthony Salim and Nirwan Bakrie (2026)." },
        { symbol: "BRMS", confidence: "unverified", note: "Press still calls it Bakrie group; the largest holder (Emirates Tarian, ~25%) is reported as Salim-linked." },
      ],
      sources: [
        { label: "Katadata: 12 Bakrie group companies (Apr 2026)", url: "https://katadata.co.id/finansial/bursa/69dc775e5fd34/adu-kinerja-12-emiten-grup-bakrie-bumi-dewa-bnbr-hingga-unsp-siapa-terkuat" },
        { label: "Katadata: BUMI names Anthony Salim as beneficial owner", url: "https://katadata.co.id/amp/finansial/bursa/698d27e19ff9d/bumi-tetapkan-anthony-salim-penerima-manfaat-akhir-free-float-melonjak-ke-41-3/" },
        { label: "IDNFinancials: Bakrie capital injection into ENRG", url: "https://www.idnfinancials.com/news/64491/bakrie-group-injects-massive-capital-injection-into-enrg" },
        { label: "KabarBursa: BRMS largest shareholders (Sep 2026)", url: "https://www.kabarbursa.com/market-hari-ini/investor-brms-naik-pada-september-2026-siapa-pemegang-saham-terbesar.md" },
      ],
    },
    {
      id: "lippo", name: { id: "Grup Lippo", en: "Lippo Group" }, confidence: "sourced", reviewedAt: REVIEWED,
      note: "Riady family. SILO and NOBU are no longer Lippo-controlled and are left out.",
      members: [
        { symbol: "LPKR" }, { symbol: "LPCK" }, { symbol: "MLPL" }, { symbol: "MLPT" }, { symbol: "MPPA" }, { symbol: "LPLI" },
        { symbol: "LPPF", note: "Controlled by Auric Digital Retail (Riady-linked); MLPL holds ~19%." },
      ],
      sources: [
        { label: "CNBC Indonesia: who is behind Auric (LPPF)", url: "https://www.cnbcindonesia.com/market/20210604121723-17-250581/siapa-di-balik-auric-pengendali-baru-gerai-ritel-matahari" },
        { label: "Kontan: LPLI, a Lippo holding company", url: "https://investasi.kontan.co.id/news/geliat-lpli-sang-induk-grup-lippo" },
        { label: "Detik: CVC takes over Siloam (why SILO is out)", url: "https://finance.detik.com/bursa-dan-valas/d-7479122/cvc-capital-partners-resmi-caplok-saham-siloam-hospitals-indonesia-rp-16-68-t" },
        { label: "Bisnis: Hanwha Life controls Bank Nobu (why NOBU is out)", url: "https://finansial.bisnis.com/read/20250701/90/1889273/hanwha-life-jadi-pengendali-baru-bank-nobu-usai-akuisisi-40-saham" },
      ],
    },
    {
      id: "mnc", name: { id: "Grup MNC", en: "MNC Group" }, confidence: "sourced", reviewedAt: REVIEWED,
      note: "Hary Tanoesoedibjo. IATA is no longer MNC-controlled and is left out.",
      members: [
        { symbol: "BHIT" }, { symbol: "BMTR" }, { symbol: "MNCN" }, { symbol: "MSIN" }, { symbol: "IPTV" }, { symbol: "BCAP" }, { symbol: "BABP" }, { symbol: "KPIG" },
      ],
      sources: [
        { label: "Katadata: Hary Tanoe companies (Sep 2026)", url: "https://katadata.co.id/finansial/bursa/6ab8e06eb689e/saham-hary-tanoe-meredup-5-emiten-dari-bhit-hingga-kpig-bertahan-di-level-gocap" },
        { label: "Bisnis: MNC gives up IATA control (2026)", url: "https://market.bisnis.com/read/20260719/192/1989134/lepas-kendali-grup-mnc-getol-jual-saham-batu-bara-iata" },
      ],
    },
    {
      id: "alamtri", name: { id: "Grup AlamTri (Adaro)", en: "AlamTri Group (Adaro)" }, confidence: "sourced", reviewedAt: REVIEWED,
      note: "Thohir family and partners.",
      members: [
        { symbol: "ADRO", note: "Now PT AlamTri Resources Indonesia." }, { symbol: "ADMR", note: "About 84% held by ADRO." },
        { symbol: "AADI", confidence: "unverified", note: "Sister company after the Dec 2024 spin-off, not an ADRO subsidiary; controller not confirmed." },
      ],
      sources: [
        { label: "Bisnis: AlamTri group ADRO, ADMR, AADI (2025)", url: "https://market.bisnis.com/read/20250603/192/1882081/cek-prospek-grup-alamtri-adro-admr-yang-bagi-dividen-hingga-aadi" },
        { label: "Bisnis: Boy Thohir's companies, 2024 profits", url: "https://market.bisnis.com/read/20250305/192/1846037/rapor-laba-bersih-emiten-boy-thohir-adro-aadi-admr-pada-2024-siapa-jawara" },
        { label: "Tempo: AADI listed after the spin-off", url: "https://en.tempo.co/read/1949070/adaro-andalan-indonesia-aadi-officially-listed-on-the-indonesia-stock-exchangeindeks" },
      ],
    },
    {
      id: "emtek", name: { id: "Grup Emtek", en: "Emtek Group" }, confidence: "sourced", reviewedAt: REVIEWED,
      note: "Sariaatmadja family.",
      members: [
        { symbol: "EMTK" }, { symbol: "SCMA", note: "About 74% held by Emtek (2026)." },
        { symbol: "BUKA", note: "About 45.7% held through PT Kreatif Media Karya; Emtek says it is the controller." }, { symbol: "SAME", note: "About 85% held by Emtek." },
      ],
      sources: [
        { label: "Katadata: Emtek unit buys more BUKA", url: "https://katadata.co.id/digital/teknologi/6a9fb6777e3b9/kmk-grup-emtek-borong-saham-buka-gaming-jadi-andalan-bukalapak" },
        { label: "IDNFinancials: SCMA controller stake to 74%", url: "https://www.idnfinancials.com/cn/news/61316/pengendali-borong-2-68-miliar-saham-scma-kepemilikan-jadi-74-02" },
        { label: "Investortrust: Emtek adds SAME shares", url: "https://investortrust.id/market/14122/gelontorkan-miliaran-elang-mahkota-emtk-lanjut-tambah-saham-di-sarana-meditama-same" },
      ],
    },
    {
      id: "ctcorp", name: { id: "CT Corp", en: "CT Corp" }, confidence: "sourced", reviewedAt: REVIEWED,
      note: "Chairul Tanjung, through Mega Corpora. Sources are from 2021–2022; no later change found.",
      members: [{ symbol: "MEGA" }, { symbol: "BBHI" }],
      sources: [
        { label: "Kontan: CT Corp banking footprint", url: "https://insight.kontan.co.id/news/sulur-bisnis-ct-corp-di-perbankan-semakin-menjalar" },
        { label: "Bisnis: Allo Bank joins Mega Corpora", url: "https://finansial.bisnis.com/read/20220116/90/1489604/allo-bank-bbhi-resmi-masuk-kelompok-usaha-bank-milik-mega-corpora" },
      ],
    },
    {
      id: "panin", name: { id: "Grup Panin", en: "Panin Group" }, confidence: "sourced", reviewedAt: REVIEWED,
      note: "Gunawan family. ANZ (~38.8% of PNBN) has held talks on a sale of control; none completed as of this review.",
      members: [{ symbol: "PNIN" }, { symbol: "PNLF" }, { symbol: "PNBN", note: "PNLF ~46%, ANZ ~38.8%." }, { symbol: "PNBS", note: "About 67% held by PNBN." }],
      sources: [
        { label: "IDX Channel: who owns Panin Bank", url: "https://www.idxchannel.com/milenomic/mengenal-siapa-pemilik-panin-bank-profil-dan-perjalanannya/all" },
        { label: "Mikirduit: Panin group structure", url: "https://www.mikirduit.com/jejak-grup-panin-dari-siklus-wacana-akuisisi-pnbn-hingga-drama-kija/" },
        { label: "Kontan: PNBN stake sale stalled", url: "https://keuangan.kontan.co.id/news/harga-tidak-cocok-penjualan-saham-bank-panin-pnbn-terhenti" },
      ],
    },
    {
      id: "saratoga", name: { id: "Grup Saratoga", en: "Saratoga Group" }, confidence: "sourced", reviewedAt: REVIEWED,
      members: [
        { symbol: "SRTG" }, { symbol: "MPMX", note: "About 56.7% held by Saratoga." },
        { symbol: "TBIG", note: "About 81.7% held by Bersama Digital Infrastructure Asia, described by the press as Saratoga group; whether that holding is joint was not confirmed." },
      ],
      sources: [
        { label: "Bisnis: MPMX controlled by Saratoga", url: "https://market.bisnis.com/read/20221225/192/1612012/komisaris-cucu-usaha-saratoga-mpmx-borong-saham-rp33-miliar" },
        { label: "IDNFinancials: TBIG, a Saratoga group company", url: "https://www.idnfinancials.com/cn/news/66376/saratoga-groups-tbig-eyes-idr-1-25-billion-through-debt-issuance" },
        { label: "EmitenNews: Saratoga group stocks", url: "https://www.emitennews.com/news/intip-grup-saratoga-tbig-dan-mpmx-menguat-kala-mdka-tertekan" },
      ],
    },
    {
      id: "merdeka", name: { id: "Grup Merdeka", en: "Merdeka Group" }, confidence: "sourced", reviewedAt: REVIEWED,
      members: [{ symbol: "MDKA" }, { symbol: "MBMA" }, { symbol: "EMAS", note: "Listed 23 Sep 2025; MDKA holds ~62.7%." }],
      sources: [{ label: "IDNFinancials: Merdeka group's EMAS debut", url: "https://www.idnfinancials.com/news/57397/merdeka-groups-emas-skyrockets-to-upper-limit-on-debut" }],
    },
    {
      id: "harita", name: { id: "Grup Harita", en: "Harita Group" }, confidence: "sourced", reviewedAt: REVIEWED,
      note: "PT Harita Jayaraya; Glencore holds minority stakes in both.",
      members: [{ symbol: "NCKL" }, { symbol: "CITA" }],
      sources: [
        { label: "IDNFinancials: Glencore stakes in Harita companies", url: "https://www.idnfinancials.com/news/57462/glencore-enters-another-harita-firm-acquires-7-2-of-nickel-business" },
        { label: "Bisnis: Harita on NCKL investors", url: "https://ekonomi.bisnis.com/read/20240403/44/1755343/bos-harita-buka-bukaan-soal-3-calon-investor-strategis-nckl" },
      ],
    },
    {
      id: "mayapada", name: { id: "Grup Mayapada", en: "Mayapada Group" }, confidence: "sourced", reviewedAt: REVIEWED,
      note: "Dato' Sri Tahir.",
      members: [{ symbol: "MAYA" }, { symbol: "SRAJ", note: "Mayapada Hospital." }],
      sources: [
        { label: "Bisnis: MAYA ownership after the 2024 rights issue", url: "https://finansial.bisnis.com/read/20240122/90/1734289/right-issue-rampung-kepemilikan-asing-di-bank-mayapada-maya-susut" },
        { label: "Bisnis: SRAJ shareholders", url: "https://market.bisnis.com/read/20230921/192/1697365/rs-mayapada-sraj-pertimbangkan-free-float-75-persen" },
      ],
    },
    {
      id: "agung-sedayu", name: { id: "Grup Agung Sedayu", en: "Agung Sedayu Group" }, confidence: "sourced", reviewedAt: REVIEWED,
      note: "Joint control with Salim through PT Multi Artha Pratama.",
      members: [{ symbol: "PANI" }, { symbol: "CBDK", note: "About 46% held by PANI." }],
      sources: [
        { label: "Bisnis: CBDK controllers before the IPO", url: "https://market.bisnis.com/read/20250111/192/1830740/4-sosok-pengendali-bangun-kosambi-cbdk-jelang-ipo-ada-keluarga-aguan" },
        { label: "Investortrust: Agung Sedayu and Salim behind CBDK", url: "https://www.investortrust.id/market/50519/pertaruhan-agung-sedayu-dan-salim-grup-dibalik-ipo-saham-bangun-kosambi-cbdk" },
      ],
    },
    {
      id: "map", name: { id: "Grup MAP", en: "MAP Group" }, confidence: "sourced", reviewedAt: REVIEWED,
      note: "MAPI is the parent of MAPA and MAPB. Control of MAPI changed on 8 May 2026 (Pacific Universal Investments with CVC bought 51%).",
      members: [{ symbol: "MAPI" }, { symbol: "MAPA" }, { symbol: "MAPB" }],
      sources: [
        { label: "Bareksa: MAPI changes controller (May 2026)", url: "https://www.bareksa.com/berita/saham/2026-05-08/mapi-berganti-pengendali-pacific-universal-akuisisi-51-saham-senilai-rp1181-triliun" },
        { label: "Bisnis: MAPI, MAPA, MAPB profile", url: "https://market.bisnis.com/read/20250910/192/1910107/profil-mitra-adiperkasa-mapi-mapb-mapa-yang-dikabarkan-bakal-diakuisisi-perusahaan-singapura" },
      ],
    },
    {
      id: "alfa", name: { id: "Grup Alfa", en: "Alfa Group" }, confidence: "sourced", reviewedAt: REVIEWED,
      note: "Djoko Susanto.",
      members: [{ symbol: "AMRT" }, { symbol: "MIDI", note: "About 89% held by AMRT." }],
      sources: [{ label: "Bisnis: Djoko Susanto's AMRT and MIDI", url: "https://market.bisnis.com/read/20250411/192/1868253/manuver-emiten-djoko-susanto-midi-amrt-di-bisnis-ritel-lawson" }],
    },
    {
      id: "bumn-banks", name: { id: "BUMN (Danantara) — Bank", en: "State-owned (Danantara) — Banks" }, confidence: "sourced", reviewedAt: REVIEWED,
      note: "The state's Series B shares moved to Danantara's operating holding (BKI) in March 2025; the state keeps the Series A share.",
      members: [
        { symbol: "BBRI" }, { symbol: "BMRI" }, { symbol: "BBNI" }, { symbol: "BBTN" },
        { symbol: "BRIS", note: "Controlled by BMRI." }, { symbol: "AGRO", note: "About 85.7% held by BBRI." },
      ],
      sources: [
        { label: "Bisnis: state bank shares moved to Danantara", url: "https://finansial.bisnis.com/read/20250324/90/1864079/pemerintah-alihkan-saham-seri-b-bank-bumn-ke-holding-operasional-danantara" },
        { label: "Bisnis: IDX on the off-market BUMN transfer", url: "https://market.bisnis.com/read/20250325/7/1864455/bei-pengalihan-saham-bumn-terkait-danantara-di-luar-mekanisme-bursa" },
        { label: "Fortune IDN: BRI holds 85.72% of AGRO", url: "https://www.fortuneidn.com/market/tanayastri/rights-issue-agro-rampung-bri-kuasai-85-72-saham" },
      ],
    },
    {
      id: "bumn-mining", name: { id: "BUMN (Danantara) — MIND ID", en: "State-owned (Danantara) — MIND ID" }, confidence: "sourced", reviewedAt: REVIEWED,
      members: [{ symbol: "ANTM" }, { symbol: "PTBA" }, { symbol: "TINS" }],
      sources: [{ label: "Bisnis: MIND ID dividends from ANTM, PTBA, TINS", url: "https://market.bisnis.com/read/20250614/192/1884979/mind-id-bakal-raup-rp5-2-triliun-dari-dividen-antm-ptba-dan-tins" }],
    },
    {
      id: "bumn-energy", name: { id: "BUMN (Danantara) — Pertamina", en: "State-owned (Danantara) — Pertamina" }, confidence: "sourced", reviewedAt: REVIEWED,
      members: [{ symbol: "PGAS" }, { symbol: "PGEO" }, { symbol: "ELSA", note: "About 51% held by Pertamina Hulu Energi." }],
      sources: [
        { label: "Bisnis: Pertamina group stocks", url: "https://market.bisnis.com/read/20240718/7/1783446/jalur-hijau-saham-emiten-grup-pertamina-pgas-pgeo-elsa" },
        { label: "Katadata: PGEO ownership and dividend", url: "https://katadata.co.id/amp/finansial/bursa/683ee03f7d6c6/pgeo-sepakat-bagi-dividen-rp-53-per-saham-pertamina-bakal-kantongi-rp-1-64-t/" },
        { label: "Bisnis: ELSA's new parent (PHE)", url: "https://market.bisnis.com/read/20211203/192/1473458/elnusa-elsa-resmi-punya-induk-usaha-baru" },
      ],
    },
    {
      id: "bumn-telco", name: { id: "BUMN (Danantara) — Telkom", en: "State-owned (Danantara) — Telkom" }, confidence: "sourced", reviewedAt: REVIEWED,
      members: [{ symbol: "TLKM" }, { symbol: "MTEL", note: "About 72% held by Telkom (FY2024 annual report)." }],
      sources: [
        { label: "Fortune IDN: BUMN shares moved into BKI", url: "https://www.fortuneidn.com/market/pemerintah-inbreng-saham-seri-b-c-emiten-bumn-ke-bki-danantara-00-3dhnm-ptcvt2" },
        { label: "Telkom Annual Report FY2024: subsidiaries", url: "https://www.telkom.co.id/minio/show/data/image_upload/page/1754453623246_original_C.1.5%20Annual%20Report%20FY%202024,%20page%2094-99.pdf" },
      ],
    },
    {
      id: "bumn-construction", name: { id: "BUMN (Danantara) — Karya & Tol", en: "State-owned (Danantara) — Construction & Toll" }, confidence: "sourced", reviewedAt: REVIEWED,
      note: "A PTPP–ADHI merger is planned; one of the two tickers may disappear. Re-check after it closes.",
      members: [
        { symbol: "ADHI" }, { symbol: "PTPP" }, { symbol: "WIKA" }, { symbol: "WTON", note: "About 60% held by WIKA." },
        { symbol: "WEGE", note: "About 69% held by WIKA; faced a PKPU petition in Oct 2025." }, { symbol: "PPRE", note: "Subsidiary of PTPP." }, { symbol: "JSMR" },
      ],
      sources: [
        { label: "Bisnis: Danantara delays the BUMN Karya merger (2026)", url: "https://market.bisnis.com/read/20260720/192/1989379/danantara-tunda-merger-bumn-karya-himbara-dan-waskita-jadi-penentu" },
        { label: "Bisnis: WEGE PKPU petition (2025)", url: "https://market.bisnis.com/read/20251012/192/1919457/anak-usaha-wijaya-karya-wege-digugat-pkpu-harga-saham-ambles-4-17" },
        { label: "Investortrust: PPRE, a PTPP subsidiary", url: "https://investortrust.id/market/67103/pp-presisi-ppre-ganti-direksi-dan-komisaris-siap-siap-kejutan-kinerja-di-2025" },
      ],
    },
    {
      id: "bumn-cement", name: { id: "BUMN (Danantara) — SIG", en: "State-owned (Danantara) — SIG (cement)" }, confidence: "sourced", reviewedAt: REVIEWED,
      members: [{ symbol: "SMGR" }, { symbol: "SMBR", note: "Transferred to SIG in Dec 2022." }, { symbol: "SMCB", note: "Former Holcim Indonesia, held through Holderfin." }],
      sources: [
        { label: "SIG company history", url: "https://sig.id/en/history" },
        { label: "Bisnis: SMCB, an SMGR subsidiary (2026)", url: "https://market.bisnis.com/read/20260330/192/1963127/anak-usaha-smgr-smcb-cetak-pendapatan-rp1073-triliun-pada-2025" },
      ],
    },
  ],
};
