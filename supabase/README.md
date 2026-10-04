# Supabase schema

HAKAPRO has its own Supabase project, `esvktnjqcoegxfrrbnhu` (`https://esvktnjqcoegxfrrbnhu.supabase.co`). Both migrations here are applied to it, and the remote migration history uses the same versions as these files.

- `migrations/20260921002404_initial_schema.sql` is carried over unchanged from HeulaTrade.
- `migrations/20261004054238_tighten_table_grants.sql` removes the blanket table privileges that the project's legacy default privileges gave `anon` and `authenticated`, and keeps only the explicit grants. `anon` has no table access; signed-in users get what the initial schema lists, scoped by RLS.

Tables HAKAPRO uses:
- `watchlists` and `watchlist_items` (Watchlist, Watch button, Home, Ownership Changes)
- `saved_screeners` (Screener, Cmd+K)
- `alerts` and `alert_events` (EOD alert job, `/api/jobs/evaluate-alerts`)

All access from the browser goes through RLS (`*_own` policies). Only the alert job uses the service-role key, and only on the server.

`tests/rls.sql` checks cross-user isolation and anonymous denial. It passed against the project on 2026-10-04; it runs in a transaction and rolls back, so it leaves no rows.
