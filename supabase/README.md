# Supabase schema (reference copy)

These files are copied unchanged from HeulaTrade (`supabase/migrations/20260921002404_initial_schema.sql`, `supabase/tests/rls.sql`). They describe the schema **already applied** to the existing Supabase project that HAKAPRO reuses in Phase 1. HAKAPRO adds no migrations.

Tables HAKAPRO uses:
- `watchlists` and `watchlist_items` (Watchlist, Watch button, Home, Ownership Changes)
- `saved_screeners` (Screener, Cmd+K)
- `alerts` and `alert_events` (EOD alert job, `/api/jobs/evaluate-alerts`)

All access from the browser goes through RLS (`*_own` policies). Only the alert job uses the service-role key, and only on the server.

Before production, run `tests/rls.sql` against a controlled test database. It checks cross-user isolation, and it has not been executed yet (carried over from HeulaTrade's release gate).
