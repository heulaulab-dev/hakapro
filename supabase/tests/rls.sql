-- Run against an isolated Supabase local database after applying migrations.
begin;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-a@example.test', '', now(), now(), now()),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-b@example.test', '', now(), now(), now());
insert into public.watchlists (id, user_id, name) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'A'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'B');
insert into public.portfolios (id, user_id, name) values
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'A'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'B');
insert into public.watchlist_items (watchlist_id, symbol) values ('10000000-0000-4000-8000-000000000002', 'BBRI');
insert into public.workspaces (id, user_id, name) values
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'A'),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'B');
insert into public.workspace_panels (workspace_id, panel_type) values ('30000000-0000-4000-8000-000000000002', 'CHART');
insert into public.portfolio_transactions (portfolio_id, symbol, transaction_type, transaction_date, quantity, price)
values ('20000000-0000-4000-8000-000000000002', 'BBRI', 'BUY', current_date, 100, 5000);
insert into public.alerts (id, user_id, symbol, metric, operator, threshold) values
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'BBCA', 'PRICE', 'GT', 9000),
  ('40000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'BBRI', 'PRICE', 'GT', 5000);
insert into public.alert_events (alert_id, observed_value, observed_as_of) values ('40000000-0000-4000-8000-000000000002', 5100, current_date);
insert into public.notifications (user_id, type, title, message) values ('00000000-0000-4000-8000-000000000002', 'SYSTEM', 'B', 'Private');
insert into public.saved_screeners (user_id, name) values ('00000000-0000-4000-8000-000000000002', 'B');
insert into public.notes (user_id, symbol, body) values ('00000000-0000-4000-8000-000000000002', 'BBRI', 'Private');
insert into public.user_preferences (user_id) values ('00000000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$
begin
  if (select count(*) from public.watchlists) <> 1 then raise exception 'watchlist cross-user read'; end if;
  if (select count(*) from public.watchlist_items) <> 0 then raise exception 'watchlist item cross-user read'; end if;
  if (select count(*) from public.portfolios) <> 1 then raise exception 'portfolio cross-user read'; end if;
  if (select count(*) from public.workspaces) <> 1 then raise exception 'workspace cross-user read'; end if;
  if (select count(*) from public.workspace_panels) <> 0 then raise exception 'workspace panel cross-user read'; end if;
  if (select count(*) from public.portfolio_transactions) <> 0 then raise exception 'transaction cross-user read'; end if;
  if (select count(*) from public.alerts) <> 1 then raise exception 'alert cross-user read'; end if;
  if (select count(*) from public.alert_events) <> 0 then raise exception 'alert event cross-user read'; end if;
  if (select count(*) from public.notifications) <> 0 then raise exception 'notification cross-user read'; end if;
  if (select count(*) from public.saved_screeners) <> 0 then raise exception 'screener cross-user read'; end if;
  if (select count(*) from public.notes) <> 0 then raise exception 'note cross-user read'; end if;
  if (select count(*) from public.user_preferences) <> 0 then raise exception 'preferences cross-user read'; end if;
  if (select count(*) from public.watchlists where name = 'A') <> 1 then raise exception 'own watchlist unreadable'; end if;
  update public.portfolios set name = 'changed' where id = '20000000-0000-4000-8000-000000000002';
  if found then raise exception 'portfolio cross-user update'; end if;
  update public.portfolios set name = 'changed' where id = '20000000-0000-4000-8000-000000000001';
  if not found then raise exception 'own portfolio update blocked'; end if;
  begin
    insert into public.watchlist_items (watchlist_id, symbol) values ('10000000-0000-4000-8000-000000000002', 'BBCA');
    raise exception 'cross-user watchlist insert allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.portfolio_transactions (portfolio_id, symbol, transaction_type, transaction_date, quantity, price)
    values ('20000000-0000-4000-8000-000000000002', 'BBCA', 'BUY', current_date, 1, 1);
    raise exception 'cross-user transaction insert allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$
begin
  if (select count(*) from public.watchlists) <> 0 then raise exception 'anonymous watchlist read'; end if;
  if (select count(*) from public.portfolios) <> 0 then raise exception 'anonymous portfolio read'; end if;
  if (select count(*) from public.saved_screeners) <> 0 then raise exception 'anonymous screener read'; end if;
  if (select count(*) from public.notifications) <> 0 then raise exception 'anonymous notification read'; end if;
end $$;
rollback;
