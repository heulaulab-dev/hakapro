# Morning brief source and design

StockMap's public [Daily Feed](https://stockmap.jatevo.ai/dashboard/#feed) groups the last five sessions by day and filters 52-week highs/lows, 200-day average crossings, volume surges, large moves, and ex-dividend events. Its public page does not expose a separately named Morning Brief. HakaPro already has its own Daily Feed at `/discover/feed`, so the morning module links there instead of duplicating its event engine.

The HakaPro dashboard brief combines three existing feeds: the latest market overview, headlines dated within three WIB calendar days, and corporate actions dated within the next seven WIB calendar days. Each part keeps its own loading/error state. The market section labels the source session explicitly; news and actions show their dates. Missing or undated records are not presented as current. This avoids manufacturing an overnight forecast or claiming a market view is live before the next session.

No new upstream feed, database, or scheduler is required. The dashboard uses the existing `/api/market`, `/api/news`, and `/api/actions` routes, preserving their authorization and freshness envelopes.
