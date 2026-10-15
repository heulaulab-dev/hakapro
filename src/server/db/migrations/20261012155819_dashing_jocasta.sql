CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"observed_value" numeric(24, 6) NOT NULL,
	"observed_as_of" date NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "alert_events_alert_id_observed_as_of_unique" UNIQUE("alert_id","observed_as_of")
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"metric" text NOT NULL,
	"operator" text NOT NULL,
	"threshold" numeric(24, 6) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alerts_symbol_check" CHECK ("alerts"."symbol" ~ '^[A-Z0-9]{1,12}$'),
	CONSTRAINT "alerts_metric_check" CHECK ("alerts"."metric" in ('PRICE','DAILY_CHANGE','FOREIGN_NET','VOLUME','VOLUME_RATIO_20D')),
	CONSTRAINT "alerts_operator_check" CHECK ("alerts"."operator" in ('GT','GTE','LT','LTE'))
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"symbol" text PRIMARY KEY NOT NULL,
	"website" text,
	"description" text,
	"directors" jsonb,
	"commissioners" jsonb,
	"subsidiaries" jsonb,
	"source" text NOT NULL,
	"data_as_of" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_fundamentals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"period_date" date NOT NULL,
	"period_type" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_fundamentals_symbol_period_date_period_type_unique" UNIQUE("symbol","period_date","period_type"),
	CONSTRAINT "company_fundamentals_period_type_check" CHECK ("company_fundamentals"."period_type" in ('ANNUAL','QUARTERLY')),
	CONSTRAINT "company_fundamentals_metrics_check" CHECK (jsonb_typeof("company_fundamentals"."metrics") = 'object')
);
--> statement-breakpoint
CREATE TABLE "corporate_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"event_date" date NOT NULL,
	"action_type" text NOT NULL,
	"description" text,
	"document_url" text,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_indices" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"close" numeric(24, 6),
	"change_percent" numeric(12, 8),
	"volume" numeric(24, 0),
	"value" numeric(24, 2),
	"source" text NOT NULL,
	CONSTRAINT "market_snapshots_code_as_of_unique" UNIQUE("code","as_of")
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_symbol_check" CHECK ("notes"."symbol" is null or "notes"."symbol" ~ '^[A-Z0-9]{1,12}$')
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('PRICE_ALERT','FOREIGN_FLOW_ALERT','VOLUME_ALERT','SYSTEM'))
);
--> statement-breakpoint
CREATE TABLE "ownership_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"holder_name" text NOT NULL,
	"shares" numeric(24, 0),
	"percentage" numeric(9, 6),
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ownership_snapshots_symbol_snapshot_date_holder_name_unique" UNIQUE("symbol","snapshot_date","holder_name"),
	CONSTRAINT "ownership_snapshots_percentage_check" CHECK ("ownership_snapshots"."percentage" is null or "ownership_snapshots"."percentage" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "portfolio_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"symbol" text,
	"transaction_type" text NOT NULL,
	"transaction_date" date NOT NULL,
	"quantity" numeric(24, 6),
	"price" numeric(24, 6),
	"fees" numeric(24, 6) DEFAULT '0' NOT NULL,
	"cash_amount" numeric(24, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_transactions_symbol_check" CHECK ("portfolio_transactions"."symbol" is null or "portfolio_transactions"."symbol" ~ '^[A-Z0-9]{1,12}$'),
	CONSTRAINT "portfolio_transactions_type_check" CHECK ("portfolio_transactions"."transaction_type" in ('BUY','SELL','DIVIDEND','CASH_ADJUSTMENT')),
	CONSTRAINT "portfolio_transactions_fees_check" CHECK ("portfolio_transactions"."fees" >= 0),
	CONSTRAINT "portfolio_transactions_shape_check" CHECK ((
    ("portfolio_transactions"."transaction_type" in ('BUY','SELL') and "portfolio_transactions"."symbol" is not null and "portfolio_transactions"."quantity" > 0 and "portfolio_transactions"."price" >= 0 and "portfolio_transactions"."cash_amount" is null)
    or ("portfolio_transactions"."transaction_type" = 'DIVIDEND' and "portfolio_transactions"."symbol" is not null and "portfolio_transactions"."cash_amount" >= 0 and "portfolio_transactions"."quantity" is null and "portfolio_transactions"."price" is null)
    or ("portfolio_transactions"."transaction_type" = 'CASH_ADJUSTMENT' and "portfolio_transactions"."symbol" is null and "portfolio_transactions"."cash_amount" is not null and "portfolio_transactions"."quantity" is null and "portfolio_transactions"."price" is null)
  ))
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolios_name_check" CHECK (length(trim("portfolios"."name")) between 1 and 80),
	CONSTRAINT "portfolios_currency_check" CHECK ("portfolios"."currency" = 'IDR')
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"timezone" text DEFAULT 'Asia/Jakarta' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_screeners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_screeners_name_check" CHECK (length(trim("saved_screeners"."name")) between 1 and 80),
	CONSTRAINT "saved_screeners_conditions_check" CHECK (jsonb_typeof("saved_screeners"."conditions") = 'array'),
	CONSTRAINT "saved_screeners_sort_config_check" CHECK (jsonb_typeof("saved_screeners"."sort_config") = 'object')
);
--> statement-breakpoint
CREATE TABLE "securities" (
	"symbol" text PRIMARY KEY NOT NULL,
	"company_name" text NOT NULL,
	"exchange" text DEFAULT 'IDX' NOT NULL,
	"board" text,
	"sector" text,
	"subsector" text,
	"listing_date" date,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "securities_symbol_check" CHECK ("securities"."symbol" ~ '^[A-Z0-9]{1,12}$')
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"density" text DEFAULT 'COMPACT' NOT NULL,
	"columns" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shortcuts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_density_check" CHECK ("user_preferences"."density" in ('COMPACT','COMFORTABLE')),
	CONSTRAINT "user_preferences_columns_check" CHECK (jsonb_typeof("user_preferences"."columns") = 'object'),
	CONSTRAINT "user_preferences_shortcuts_check" CHECK (jsonb_typeof("user_preferences"."shortcuts") = 'object')
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watchlist_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_items_watchlist_id_symbol_unique" UNIQUE("watchlist_id","symbol"),
	CONSTRAINT "watchlist_items_symbol_check" CHECK ("watchlist_items"."symbol" ~ '^[A-Z0-9]{1,12}$'),
	CONSTRAINT "watchlist_items_position_check" CHECK ("watchlist_items"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlists_name_check" CHECK (length(trim("watchlists"."name")) between 1 and 80),
	CONSTRAINT "watchlists_position_check" CHECK ("watchlists"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_panels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"panel_type" text NOT NULL,
	"symbol" text,
	"is_locked" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_panels_panel_type_check" CHECK ("workspace_panels"."panel_type" in ('MARKET','WL','CHART','BROKER','FOREIGN','FUND','PROFILE','OWNERSHIP','CORP','SCREENER','NEWS','ANN','PORT','ALERTS','SIGNALS')),
	CONSTRAINT "workspace_panels_symbol_check" CHECK ("workspace_panels"."symbol" is null or "workspace_panels"."symbol" ~ '^[A-Z0-9]{1,12}$'),
	CONSTRAINT "workspace_panels_position_check" CHECK ("workspace_panels"."position" >= 0),
	CONSTRAINT "workspace_panels_settings_check" CHECK (jsonb_typeof("workspace_panels"."settings") = 'object')
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"layout" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_name_check" CHECK (length(trim("workspaces"."name")) between 1 and 80),
	CONSTRAINT "workspaces_layout_check" CHECK (jsonb_typeof("workspaces"."layout") = 'object')
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_symbol_securities_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."securities"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_fundamentals" ADD CONSTRAINT "company_fundamentals_symbol_securities_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."securities"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_symbol_securities_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."securities"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_snapshots" ADD CONSTRAINT "market_snapshots_code_market_indices_code_fk" FOREIGN KEY ("code") REFERENCES "public"."market_indices"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_snapshots" ADD CONSTRAINT "ownership_snapshots_symbol_securities_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."securities"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_transactions" ADD CONSTRAINT "portfolio_transactions_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_screeners" ADD CONSTRAINT "saved_screeners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_panels" ADD CONSTRAINT "workspace_panels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "alert_events_alert_time" ON "alert_events" USING btree ("alert_id","triggered_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "alerts_user_enabled" ON "alerts" USING btree ("user_id","enabled");--> statement-breakpoint
CREATE INDEX "company_fundamentals_symbol_period" ON "company_fundamentals" USING btree ("symbol","period_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "corporate_actions_symbol_date" ON "corporate_actions" USING btree ("symbol","event_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "market_snapshots_code_asof" ON "market_snapshots" USING btree ("code","as_of" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notes_user_symbol" ON "notes" USING btree ("user_id","symbol");--> statement-breakpoint
CREATE INDEX "notifications_user_unread" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST) WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "ownership_snapshots_symbol_date" ON "ownership_snapshots" USING btree ("symbol","snapshot_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "portfolio_transactions_order" ON "portfolio_transactions" USING btree ("portfolio_id","transaction_date","created_at");--> statement-breakpoint
CREATE INDEX "portfolios_user" ON "portfolios" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "saved_screeners_user" ON "saved_screeners" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "securities_company_name" ON "securities" USING gin (to_tsvector('simple', "company_name"));--> statement-breakpoint
CREATE INDEX "watchlist_items_list_position" ON "watchlist_items" USING btree ("watchlist_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlists_one_default" ON "watchlists" USING btree ("user_id") WHERE "watchlists"."is_default";--> statement-breakpoint
CREATE INDEX "watchlists_user_position" ON "watchlists" USING btree ("user_id","position");--> statement-breakpoint
CREATE INDEX "workspace_panels_workspace_position" ON "workspace_panels" USING btree ("workspace_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_one_default" ON "workspaces" USING btree ("user_id") WHERE "workspaces"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_user_name" ON "workspaces" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "workspaces_user" ON "workspaces" USING btree ("user_id");--> statement-breakpoint

-- Keep source timestamp and alert side effects at the database boundary.
CREATE SCHEMA IF NOT EXISTS private;--> statement-breakpoint
CREATE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER touch_profiles BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER touch_watchlists BEFORE UPDATE ON public.watchlists FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER touch_workspaces BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER touch_workspace_panels BEFORE UPDATE ON public.workspace_panels FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER touch_portfolios BEFORE UPDATE ON public.portfolios FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER touch_portfolio_transactions BEFORE UPDATE ON public.portfolio_transactions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER touch_alerts BEFORE UPDATE ON public.alerts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER touch_saved_screeners BEFORE UPDATE ON public.saved_screeners FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER touch_notes BEFORE UPDATE ON public.notes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER touch_user_preferences BEFORE UPDATE ON public.user_preferences FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint

CREATE FUNCTION private.notify_alert_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  owner_id uuid;
  alert_symbol text;
  alert_metric text;
BEGIN
  SELECT user_id, symbol, metric INTO owner_id, alert_symbol, alert_metric
  FROM public.alerts WHERE id = NEW.alert_id;
  IF owner_id IS NULL THEN RAISE EXCEPTION 'Alert owner missing'; END IF;
  UPDATE public.alerts SET last_triggered_at = NEW.triggered_at WHERE id = NEW.alert_id;
  INSERT INTO public.notifications (user_id, type, title, message, entity_type, entity_id)
  VALUES (
    owner_id,
    CASE WHEN alert_metric IN ('PRICE','DAILY_CHANGE') THEN 'PRICE_ALERT'
         WHEN alert_metric = 'FOREIGN_NET' THEN 'FOREIGN_FLOW_ALERT'
         ELSE 'VOLUME_ALERT' END,
    alert_symbol || ' ' || alert_metric || ' alert',
    'Observed ' || NEW.observed_value || ' as of ' || NEW.observed_as_of,
    'alert',
    NEW.alert_id
  );
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.notify_alert_event() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER alert_event_notification AFTER INSERT ON public.alert_events
FOR EACH ROW EXECUTE FUNCTION private.notify_alert_event();
