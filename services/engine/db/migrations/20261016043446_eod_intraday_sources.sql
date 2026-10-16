CREATE TABLE "eod_sessions" (
	"date" date PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"expected" integer DEFAULT 0 NOT NULL,
	"present" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"finalized_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "index_intraday" (
	"code" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"name" text,
	"last" numeric(18, 4) NOT NULL,
	"open" numeric(18, 4),
	"high" numeric(18, 4),
	"low" numeric(18, 4),
	"change_percent" numeric(14, 8),
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"raw_ref" uuid,
	CONSTRAINT "index_intraday_pk" PRIMARY KEY("code","ts","source")
);
--> statement-breakpoint
ALTER TABLE "daily_prices" ADD COLUMN "adj_close" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "daily_prices" ADD COLUMN "value_source" text;--> statement-breakpoint
ALTER TABLE "daily_prices" ADD COLUMN "value_raw_ref" uuid;--> statement-breakpoint
ALTER TABLE "daily_prices" ADD COLUMN "foreign_source" text;--> statement-breakpoint
ALTER TABLE "daily_prices" ADD COLUMN "foreign_as_of" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "daily_prices" ADD COLUMN "foreign_raw_ref" uuid;--> statement-breakpoint
ALTER TABLE "index_daily" ADD COLUMN "change_percent" numeric(14, 8);--> statement-breakpoint
ALTER TABLE "index_daily" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "intraday_snapshots" ADD COLUMN "open" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "intraday_snapshots" ADD COLUMN "high" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "intraday_snapshots" ADD COLUMN "low" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "intraday_snapshots" ADD COLUMN "change_percent" numeric(14, 8);--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "market_cap" bigint;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "free_float_pct" numeric(9, 4);--> statement-breakpoint
ALTER TABLE "index_intraday" ADD CONSTRAINT "index_intraday_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "index_intraday_ts" ON "index_intraday" USING btree ("ts");--> statement-breakpoint
ALTER TABLE "daily_prices" ADD CONSTRAINT "daily_prices_value_raw_ref_raw_documents_id_fk" FOREIGN KEY ("value_raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_prices" ADD CONSTRAINT "daily_prices_foreign_raw_ref_raw_documents_id_fk" FOREIGN KEY ("foreign_raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;