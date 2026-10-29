# Issuer performance race

The Issuer performance race on `/discover/rotation` ranks the 12 strongest currently priced issuers in the selected
sector (or all active sectors) over a 1M, 3M, 6M, or 1Y session window. The user can step or play through sampled EOD
sessions. Reduced-motion users keep manual stepping and do not get automatic playback.

## Data and calculation

- Reads only persisted `daily_prices` closes and the active `securities` snapshot from the Data Engine. It makes no
  provider call from a page request and adds no ingestion source or database table.
- The baseline is the first session in the selected market-wide session window. A security is eligible only if it has
  a positive close on that exact session; missing baseline values are not carried from an earlier date.
- For each playback date, the return is `100 × (close / baseline close − 1)`. Only securities with a positive close on
  that exact date are ranked; missing prices are not filled forward or interpolated.
- Long windows are sampled to no more than 52 playback frames. Each frame carries no more than 12 leaders, while the
  response reports the number of selected active names, baseline-qualified names, and names with a close on that frame.
- The issuer universe is capped at 2,500 active securities. The UI marks a truncated universe if the cap is exceeded.

## Interpretation limits

This is a price-return comparison, not total return: cash distributions are excluded. Sector membership comes from the
current security master and can differ from historical membership. Data is labelled with its Engine freshness and
session date. The race is historical research, not a forecast or trading recommendation.

The existing sector RRG remains a separate display. IDX sector-index coverage and source authorization must be verified
before extending the RRG to issuer-vs-sector benchmark comparisons; this race does not synthesize or present a sector
index.
