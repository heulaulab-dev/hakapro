create extension if not exists pgcrypto;
create schema if not exists private;

create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text, avatar_url text, timezone text not null default 'Asia/Jakarta',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.watchlists (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80), is_default boolean not null default false,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index watchlists_one_default on public.watchlists(user_id) where is_default;
create index watchlists_user_position on public.watchlists(user_id, position);
create table public.watchlist_items (
  id uuid primary key default gen_random_uuid(), watchlist_id uuid not null references public.watchlists(id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Z0-9]{1,12}$'), position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(), unique(watchlist_id, symbol)
);
create index watchlist_items_list_position on public.watchlist_items(watchlist_id, position);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80), is_default boolean not null default false,
  layout jsonb not null default '{}'::jsonb check (jsonb_typeof(layout) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index workspaces_one_default on public.workspaces(user_id) where is_default;
create unique index workspaces_user_name on public.workspaces(user_id, name);
create index workspaces_user on public.workspaces(user_id);
create table public.workspace_panels (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  panel_type text not null check (panel_type in ('MARKET','WL','CHART','BROKER','FOREIGN','FUND','PROFILE','OWNERSHIP','CORP','SCREENER','NEWS','ANN','PORT','ALERTS','SIGNALS')),
  symbol text check (symbol is null or symbol ~ '^[A-Z0-9]{1,12}$'), is_locked boolean not null default false,
  position integer not null default 0 check (position >= 0), settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index workspace_panels_workspace_position on public.workspace_panels(workspace_id, position);

create table public.portfolios (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80), currency text not null default 'IDR' check (currency = 'IDR'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index portfolios_user on public.portfolios(user_id);
create table public.portfolio_transactions (
  id uuid primary key default gen_random_uuid(), portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  symbol text check (symbol is null or symbol ~ '^[A-Z0-9]{1,12}$'),
  transaction_type text not null check (transaction_type in ('BUY','SELL','DIVIDEND','CASH_ADJUSTMENT')),
  transaction_date date not null, quantity numeric(24,6), price numeric(24,6), fees numeric(24,6) not null default 0 check (fees >= 0),
  cash_amount numeric(24,2), notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check ((transaction_type in ('BUY','SELL') and symbol is not null and quantity > 0 and price >= 0 and cash_amount is null)
    or (transaction_type = 'DIVIDEND' and symbol is not null and cash_amount >= 0 and quantity is null and price is null)
    or (transaction_type = 'CASH_ADJUSTMENT' and symbol is null and cash_amount is not null and quantity is null and price is null))
);
create index portfolio_transactions_order on public.portfolio_transactions(portfolio_id, transaction_date, created_at);

create table public.alerts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Z0-9]{1,12}$'),
  metric text not null check (metric in ('PRICE','DAILY_CHANGE','FOREIGN_NET','VOLUME','VOLUME_RATIO_20D')),
  operator text not null check (operator in ('GT','GTE','LT','LTE')),
  threshold numeric(24,6) not null, enabled boolean not null default true,
  last_triggered_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index alerts_user_enabled on public.alerts(user_id, enabled);
create table public.alert_events (
  id uuid primary key default gen_random_uuid(), alert_id uuid not null references public.alerts(id) on delete cascade,
  observed_value numeric(24,6) not null, observed_as_of date not null, triggered_at timestamptz not null default now(), read_at timestamptz,
  unique(alert_id, observed_as_of)
);
create index alert_events_alert_time on public.alert_events(alert_id, triggered_at desc);
create function private.notify_alert_event() returns trigger language plpgsql security definer set search_path = '' as $$
declare owner_id uuid; alert_symbol text; alert_metric text;
begin
  select user_id, symbol, metric into owner_id, alert_symbol, alert_metric from public.alerts where id = new.alert_id;
  if owner_id is null then raise exception 'Alert owner missing'; end if;
  update public.alerts set last_triggered_at = new.triggered_at where id = new.alert_id;
  insert into public.notifications (user_id, type, title, message, entity_type, entity_id)
  values (owner_id, case when alert_metric in ('PRICE','DAILY_CHANGE') then 'PRICE_ALERT' when alert_metric = 'FOREIGN_NET' then 'FOREIGN_FLOW_ALERT' else 'VOLUME_ALERT' end,
    alert_symbol || ' ' || alert_metric || ' alert', 'Observed ' || new.observed_value || ' as of ' || new.observed_as_of,
    'alert', new.alert_id);
  return new;
end $$;
revoke all on function private.notify_alert_event() from public;
create trigger alert_event_notification after insert on public.alert_events for each row execute function private.notify_alert_event();
create table public.notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('PRICE_ALERT','FOREIGN_FLOW_ALERT','VOLUME_ALERT','SYSTEM')),
  title text not null, message text not null, entity_type text, entity_id uuid, read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_unread on public.notifications(user_id, created_at desc) where read_at is null;
create table public.saved_screeners (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(conditions) = 'array'),
  sort_config jsonb not null default '{}'::jsonb check (jsonb_typeof(sort_config) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index saved_screeners_user on public.saved_screeners(user_id);
create table public.notes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol text check (symbol is null or symbol ~ '^[A-Z0-9]{1,12}$'), body text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index notes_user_symbol on public.notes(user_id, symbol);
create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  density text not null default 'COMPACT' check (density in ('COMPACT','COMFORTABLE')),
  columns jsonb not null default '{}'::jsonb check (jsonb_typeof(columns) = 'object'),
  shortcuts jsonb not null default '{}'::jsonb check (jsonb_typeof(shortcuts) = 'object'),
  updated_at timestamptz not null default now()
);

create table public.securities (
  symbol text primary key check (symbol ~ '^[A-Z0-9]{1,12}$'), company_name text not null,
  exchange text not null default 'IDX', board text, sector text, subsector text,
  listing_date date, status text not null default 'ACTIVE', updated_at timestamptz not null default now()
);
create index securities_company_name on public.securities using gin (to_tsvector('simple', company_name));
create table public.companies (
  symbol text primary key references public.securities(symbol) on delete cascade,
  website text, description text, directors jsonb, commissioners jsonb, subsidiaries jsonb,
  source text not null, data_as_of date, updated_at timestamptz not null default now()
);
create table public.company_fundamentals (
  id uuid primary key default gen_random_uuid(), symbol text not null references public.securities(symbol) on delete cascade,
  period_date date not null, period_type text not null check (period_type in ('ANNUAL','QUARTERLY')),
  metrics jsonb not null check (jsonb_typeof(metrics) = 'object'), source text not null,
  updated_at timestamptz not null default now(), unique(symbol, period_date, period_type)
);
create index company_fundamentals_symbol_period on public.company_fundamentals(symbol, period_date desc);
create table public.corporate_actions (
  id uuid primary key default gen_random_uuid(), symbol text not null references public.securities(symbol) on delete cascade,
  event_date date not null, action_type text not null, description text, document_url text,
  source text not null, updated_at timestamptz not null default now()
);
create index corporate_actions_symbol_date on public.corporate_actions(symbol, event_date desc);
create table public.ownership_snapshots (
  id uuid primary key default gen_random_uuid(), symbol text not null references public.securities(symbol) on delete cascade,
  snapshot_date date not null, holder_name text not null, shares numeric(24,0), percentage numeric(9,6),
  source text not null, updated_at timestamptz not null default now(),
  check (percentage is null or percentage between 0 and 100), unique(symbol, snapshot_date, holder_name)
);
create index ownership_snapshots_symbol_date on public.ownership_snapshots(symbol, snapshot_date desc);
create table public.market_indices (
  code text primary key, name text not null, source text not null, updated_at timestamptz not null default now()
);
create table public.market_snapshots (
  id uuid primary key default gen_random_uuid(), code text not null references public.market_indices(code),
  as_of timestamptz not null, close numeric(24,6), change_percent numeric(12,8), volume numeric(24,0), value numeric(24,2),
  source text not null, unique(code, as_of)
);
create index market_snapshots_code_asof on public.market_snapshots(code, as_of desc);

do $$ declare table_name text; begin
  foreach table_name in array array['profiles','watchlists','workspaces','workspace_panels','portfolios','portfolio_transactions','alerts','saved_screeners','notes','user_preferences'] loop
    execute format('create trigger touch_%I before update on public.%I for each row execute function public.touch_updated_at()', table_name, table_name);
  end loop;
end $$;

do $$ declare table_name text; begin
  foreach table_name in array array['profiles','watchlists','watchlist_items','workspaces','workspace_panels','portfolios','portfolio_transactions','alerts','alert_events','notifications','saved_screeners','notes','user_preferences','securities','companies','company_fundamentals','corporate_actions','ownership_snapshots','market_indices','market_snapshots'] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

create policy profiles_own on public.profiles for all to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy watchlists_own on public.watchlists for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy workspaces_own on public.workspaces for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy portfolios_own on public.portfolios for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy alerts_own on public.alerts for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy notifications_read on public.notifications for select to authenticated using ((select auth.uid()) = user_id);
create policy notifications_update on public.notifications for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy saved_screeners_own on public.saved_screeners for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy notes_own on public.notes for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy user_preferences_own on public.user_preferences for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create function public.save_workspace(p_name text, p_layout jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare result_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if length(trim(p_name)) not between 1 and 80 or jsonb_typeof(p_layout) <> 'object' then raise exception 'Invalid workspace'; end if;
  update public.workspaces set is_default = false where user_id = (select auth.uid()) and is_default;
  insert into public.workspaces (user_id, name, layout, is_default)
  values ((select auth.uid()), trim(p_name), p_layout, true)
  on conflict (user_id, name) do update set layout = excluded.layout, is_default = true
  returning id into result_id;
  return result_id;
end $$;
revoke all on function public.save_workspace(text, jsonb) from public;
grant execute on function public.save_workspace(text, jsonb) to authenticated;

create policy watchlist_items_own on public.watchlist_items for all to authenticated
using (exists (select 1 from public.watchlists p where p.id = watchlist_id and p.user_id = (select auth.uid())))
with check (exists (select 1 from public.watchlists p where p.id = watchlist_id and p.user_id = (select auth.uid())));
create policy workspace_panels_own on public.workspace_panels for all to authenticated
using (exists (select 1 from public.workspaces p where p.id = workspace_id and p.user_id = (select auth.uid())))
with check (exists (select 1 from public.workspaces p where p.id = workspace_id and p.user_id = (select auth.uid())));
create policy portfolio_transactions_own on public.portfolio_transactions for all to authenticated
using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())))
with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())));
create policy alert_events_own on public.alert_events for select to authenticated
using (exists (select 1 from public.alerts p where p.id = alert_id and p.user_id = (select auth.uid())));

-- New Supabase projects no longer expose public tables to the Data API by default.
-- RLS still decides which rows each authenticated user may access.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on public.profiles, public.watchlists, public.watchlist_items,
  public.workspaces, public.workspace_panels, public.portfolios, public.portfolio_transactions,
  public.alerts, public.saved_screeners, public.notes, public.user_preferences to authenticated;
grant select on public.alert_events to authenticated;
grant select, update on public.notifications to authenticated;
grant select on public.securities, public.companies, public.company_fundamentals,
  public.corporate_actions, public.ownership_snapshots, public.market_indices, public.market_snapshots to authenticated;
grant select, insert, update, delete on public.profiles, public.watchlists, public.watchlist_items,
  public.workspaces, public.workspace_panels, public.portfolios, public.portfolio_transactions,
  public.alerts, public.alert_events, public.notifications, public.saved_screeners, public.notes,
  public.user_preferences, public.securities, public.companies, public.company_fundamentals,
  public.corporate_actions, public.ownership_snapshots, public.market_indices, public.market_snapshots to service_role;

do $$ declare table_name text; begin
  foreach table_name in array array['securities','companies','company_fundamentals','corporate_actions','ownership_snapshots','market_indices','market_snapshots'] loop
    execute format('create policy market_read on public.%I for select to authenticated using (true)', table_name);
  end loop;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-exports', 'user-exports', false, 20971520, array['text/csv','application/pdf']) on conflict (id) do nothing;
create policy export_read on storage.objects for select to authenticated using (bucket_id = 'user-exports' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy export_insert on storage.objects for insert to authenticated with check (bucket_id = 'user-exports' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy export_update on storage.objects for update to authenticated using (bucket_id = 'user-exports' and (storage.foldername(name))[1] = (select auth.uid())::text) with check (bucket_id = 'user-exports' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy export_delete on storage.objects for delete to authenticated using (bucket_id = 'user-exports' and (storage.foldername(name))[1] = (select auth.uid())::text);

alter publication supabase_realtime add table public.watchlists, public.watchlist_items, public.workspaces, public.workspace_panels, public.portfolios, public.portfolio_transactions, public.alert_events, public.notifications;
