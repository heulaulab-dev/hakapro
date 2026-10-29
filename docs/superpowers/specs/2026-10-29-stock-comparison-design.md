# Stock comparison workspace

## Intent

Add a dedicated comparison workspace that lets signed-in HakaPro users compare two to four IDX symbols using data already available from the market source. The experience follows the reference: ticker chips, a normalized performance chart, and compact comparison metrics, with dates and freshness preserved.

## Goals

- Persist selected symbols and range in the URL so the workspace is shareable and refresh-safe.
- Use existing daily history, quote, profile, and analysis endpoints; do not create a parallel data pipeline.
- Normalize each selected close series to 100 at the first point in the selected range.
- Show honest loading, partial, stale, and unavailable states.
- Reuse HakaPro panels, controls, chart primitives, ticker logos, and localization.

## Non-goals

- No recommendations, rankings, or invented valuation metrics.
- No new Engine endpoint unless existing API shapes cannot support the view.
- No cross-market comparison; symbols must be IDX-listed and capped at four.

## Approach

The existing `AnalysisCompare` component remains focused on point-in-time signal comparison. A new route `/discover/compare` composes `useHistory`, `usePrice`, `useProfile`, and `useAnalysis` for each selected symbol. A client view owns URL selection and range state, while a pure normalization helper converts daily closes into chart series and return summaries. Existing `MultiLineChart` renders the series. This keeps the feature source-backed and makes the comparison screen independently extensible.

## Data behavior

Ranges are 1M, 3M, 6M, and 1Y. History requests use the existing daily frame and date bounds. Missing points are retained as gaps; a symbol without enough closes is shown as unavailable. The table exposes latest close, period return, latest daily move, RSI, foreign net shares, and analysis score only when those values are present. Every panel carries the newest source date/freshness available.

## Accessibility and responsive behavior

Ticker controls are real buttons with pressed state and keyboard focus. Chart has an accessible label and the table remains horizontally scrollable on small screens. Reduced-motion behavior follows existing chart defaults.
