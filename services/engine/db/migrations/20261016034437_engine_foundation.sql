CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"symbol" text,
	"published_at" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"category" text,
	"document_url" text,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"raw_ref" uuid,
	CONSTRAINT "announcements_source_external" UNIQUE("source","external_id")
);
--> statement-breakpoint
CREATE TABLE "corporate_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"type" text NOT NULL,
	"ex_date" date,
	"record_date" date,
	"payment_date" date,
	"ratio" text,
	"amount" numeric(20, 6),
	"description" text,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"raw_ref" uuid,
	CONSTRAINT "corporate_actions_natural" UNIQUE("source","symbol","type","ex_date")
);
--> statement-breakpoint
CREATE TABLE "daily_prices" (
	"symbol" text NOT NULL,
	"date" date NOT NULL,
	"open" numeric(18, 4),
	"high" numeric(18, 4),
	"low" numeric(18, 4),
	"close" numeric(18, 4) NOT NULL,
	"previous_close" numeric(18, 4),
	"volume" bigint,
	"value" bigint,
	"frequency" bigint,
	"foreign_buy" bigint,
	"foreign_sell" bigint,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"raw_ref" uuid,
	CONSTRAINT "daily_prices_pk" PRIMARY KEY("symbol","date"),
	CONSTRAINT "daily_prices_close_check" CHECK ("daily_prices"."close" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fetch_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" text NOT NULL,
	"source_id" text,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"documents_fetched" integer DEFAULT 0 NOT NULL,
	"documents_new" integer DEFAULT 0 NOT NULL,
	"rows_ingested" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "index_daily" (
	"code" text NOT NULL,
	"date" date NOT NULL,
	"open" numeric(18, 4),
	"high" numeric(18, 4),
	"low" numeric(18, 4),
	"close" numeric(18, 4) NOT NULL,
	"previous_close" numeric(18, 4),
	"change" numeric(18, 4),
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"raw_ref" uuid,
	CONSTRAINT "index_daily_pk" PRIMARY KEY("code","date")
);
--> statement-breakpoint
CREATE TABLE "intraday_snapshots" (
	"symbol" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"last" numeric(18, 4),
	"change" numeric(18, 4),
	"volume" bigint,
	"value" bigint,
	"frequency" bigint,
	"best_bid" numeric(18, 4),
	"best_offer" numeric(18, 4),
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"raw_ref" uuid,
	CONSTRAINT "intraday_snapshots_pk" PRIMARY KEY("symbol","ts","source")
);
--> statement-breakpoint
CREATE TABLE "job_cursors" (
	"job_id" text PRIMARY KEY NOT NULL,
	"cursor" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"outlet" text NOT NULL,
	"symbols" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"raw_ref" uuid,
	CONSTRAINT "news_items_url" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "raw_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"url" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"http_status" integer NOT NULL,
	"sha256" text NOT NULL,
	"r2_key" text NOT NULL,
	"content_type" text,
	"byte_size" integer NOT NULL,
	"etag" text,
	"last_modified" text,
	"parse_status" text DEFAULT 'PENDING' NOT NULL,
	"parse_error" text,
	"fetch_run_id" uuid,
	CONSTRAINT "raw_documents_url_sha256" UNIQUE("url","sha256")
);
--> statement-breakpoint
CREATE TABLE "securities" (
	"symbol" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"board" text,
	"notation" text,
	"sector" text,
	"subsector" text,
	"listing_date" date,
	"shares_outstanding" bigint,
	"active" boolean DEFAULT true NOT NULL,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"raw_ref" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"policy" jsonb NOT NULL,
	"status" text DEFAULT 'NEVER_RUN' NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"blocked_at" timestamp with time zone,
	"block_evidence" jsonb,
	"rows_ingested" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_prices" ADD CONSTRAINT "daily_prices_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_runs" ADD CONSTRAINT "fetch_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_daily" ADD CONSTRAINT "index_daily_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intraday_snapshots" ADD CONSTRAINT "intraday_snapshots_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_documents" ADD CONSTRAINT "raw_documents_source_sources_id_fk" FOREIGN KEY ("source") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_documents" ADD CONSTRAINT "raw_documents_fetch_run_id_fetch_runs_id_fk" FOREIGN KEY ("fetch_run_id") REFERENCES "public"."fetch_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "securities" ADD CONSTRAINT "securities_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_symbol_published" ON "announcements" USING btree ("symbol","published_at");--> statement-breakpoint
CREATE INDEX "corporate_actions_symbol" ON "corporate_actions" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "daily_prices_date" ON "daily_prices" USING btree ("date");--> statement-breakpoint
CREATE INDEX "fetch_runs_job_started" ON "fetch_runs" USING btree ("job_id","started_at");--> statement-breakpoint
CREATE INDEX "intraday_snapshots_symbol_ts" ON "intraday_snapshots" USING btree ("symbol","ts");--> statement-breakpoint
CREATE INDEX "intraday_snapshots_ts" ON "intraday_snapshots" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "news_items_published" ON "news_items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "raw_documents_url_fetched" ON "raw_documents" USING btree ("url","fetched_at");--> statement-breakpoint
CREATE INDEX "raw_documents_source_fetched" ON "raw_documents" USING btree ("source","fetched_at");