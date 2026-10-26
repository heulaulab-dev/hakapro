CREATE TABLE "insider_checks" (
	"symbol" text PRIMARY KEY NOT NULL,
	"checked_date" date NOT NULL,
	"rows" integer DEFAULT 0 NOT NULL,
	"total" integer,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"raw_ref" uuid
);
--> statement-breakpoint
CREATE TABLE "insider_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"person" text NOT NULL,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action" text NOT NULL,
	"date" date NOT NULL,
	"shares_change" bigint,
	"shares_before" bigint,
	"shares_after" bigint,
	"percent_before" numeric(12, 6),
	"percent_after" numeric(12, 6),
	"percent_change" numeric(12, 6),
	"price" numeric(18, 4),
	"broker" text,
	"nationality" text,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"raw_ref" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insider_transactions_natural" UNIQUE NULLS NOT DISTINCT("symbol","date","person","action","shares_change","shares_after")
);
--> statement-breakpoint
ALTER TABLE "insider_checks" ADD CONSTRAINT "insider_checks_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insider_transactions" ADD CONSTRAINT "insider_transactions_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "insider_checks_checked_date" ON "insider_checks" USING btree ("checked_date");--> statement-breakpoint
CREATE INDEX "insider_transactions_date" ON "insider_transactions" USING btree ("date");