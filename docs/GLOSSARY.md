# HAKAPRO glossary (id / en)

This list records which terms we translate and which stay English in both locales. Copy lives in `src/i18n/messages/{id,en}.json`. Tickers (BBCA, SOCI) are never translated.

## Kept in English in both locales
Indonesian investors already use these terms in English.

| Term | Notes |
| --- | --- |
| Broker Flow, Broker Summary | Broker codes (YU, CC) are shown as-is |
| Foreign Flow, Net Foreign | Used in the id UI as "Foreign Flow" |
| Screener | |
| EOD | Only in technical contexts; the badge label is translated (Penutupan / End of day) |
| Ticker / kode saham | Ticker symbols themselves are never translated |
| FIXTURE DATA, AUTH BYPASS | Dev-only notices, kept identical so they're unmistakable |

## Translated
| Key | id | en |
| --- | --- | --- |
| freshness LIVE | Real-time | Live |
| freshness DELAYED | Tertunda | Delayed |
| freshness EOD | Penutupan | End of day |
| freshness HISTORICAL | Historis | Historical |
| freshness STALE | Usang | Stale |
| freshness UNAVAILABLE | Tidak tersedia | Unavailable |
| shares | lembar | shares |
| lot (= 100 shares) | lot | lot / lots |
| Home | Beranda | Home |
| Strategy (screener bucket) | Strategi | Strategy |
| Why matched | Alasan cocok | Why matched |

## Number units (see `src/lib/format`)
| Magnitude | id | en |
| --- | --- | --- |
| 10³ | rb (ribu) | K |
| 10⁶ | jt (juta) | M |
| 10⁹ | M (miliar) | B |
| 10¹² | T (triliun) | T |

Indonesian puts a space before the suffix (`Rp1,5 T`); English doesn't (`Rp1.5T`). Because "M" means 10⁹ in Indonesian but 10⁶ in English, the unit is always explicit and comes from a fixed table, never from Intl compact notation.
