-- Projects created with the legacy default privileges grant anon and authenticated every
-- privilege (including TRUNCATE) on new public tables. Reset to the explicit grants in the
-- initial schema so the Data API exposes only what it lists; RLS still scopes the rows.
revoke all on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;

grant select, insert, update, delete on public.profiles, public.watchlists, public.watchlist_items,
  public.workspaces, public.workspace_panels, public.portfolios, public.portfolio_transactions,
  public.alerts, public.saved_screeners, public.notes, public.user_preferences to authenticated;
grant select on public.alert_events to authenticated;
grant select, update on public.notifications to authenticated;
grant select on public.securities, public.companies, public.company_fundamentals,
  public.corporate_actions, public.ownership_snapshots, public.market_indices, public.market_snapshots to authenticated;
