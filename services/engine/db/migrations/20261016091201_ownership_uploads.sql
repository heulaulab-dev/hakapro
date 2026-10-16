CREATE TABLE "ownership_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_set_id" uuid NOT NULL,
	"from_set_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"month" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"holder_key" text NOT NULL,
	"holder_name" text NOT NULL,
	"holder_kind" text NOT NULL,
	"kind" text NOT NULL,
	"shares_before" numeric(24, 0),
	"shares_after" numeric(24, 0),
	"share_delta" numeric(25, 0),
	"percent_before" numeric(9, 6),
	"percent_after" numeric(9, 6),
	"pp_delta" numeric(10, 6),
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"from_references" text[] DEFAULT '{}'::text[] NOT NULL,
	"to_references" text[] DEFAULT '{}'::text[] NOT NULL,
	"derivation" text NOT NULL,
	CONSTRAINT "ownership_changes_to_set_holder" UNIQUE("to_set_id","holder_key")
);
--> statement-breakpoint
CREATE TABLE "ownership_snapshot_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"holder_key" text NOT NULL,
	"holder_name" text NOT NULL,
	"holder_kind" text NOT NULL,
	"shares" numeric(24, 0),
	"percent" numeric(9, 6),
	"investor_type" text,
	"local_foreign" text,
	"source_reference" text NOT NULL,
	CONSTRAINT "ownership_snapshot_rows_set_reference" UNIQUE("set_id","source_reference"),
	CONSTRAINT "ownership_snapshot_rows_kind_check" CHECK ("ownership_snapshot_rows"."holder_kind" in ('person', 'organisation', 'custodian_nominee', 'government', 'public', 'unknown')),
	CONSTRAINT "ownership_snapshot_rows_values_check" CHECK ("ownership_snapshot_rows"."shares" is not null or "ownership_snapshot_rows"."percent" is not null)
);
--> statement-breakpoint
CREATE TABLE "ownership_snapshot_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"month" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"issuer_name" text,
	"dataset" text NOT NULL,
	"threshold_percent" numeric(9, 6) NOT NULL,
	"issued_shares" numeric(24, 0),
	"source_reference" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"raw_ref" uuid NOT NULL,
	"row_count" integer NOT NULL,
	"comparison" jsonb,
	"free_float" jsonb,
	"derived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ownership_snapshot_sets_symbol_month" UNIQUE("symbol","month")
);
--> statement-breakpoint
CREATE TABLE "ownership_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"as_of_month" text NOT NULL,
	"snapshot_date" date,
	"snapshot_date_override" date,
	"source_label" text,
	"file_name" text,
	"format" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"raw_ref" uuid NOT NULL,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"error" text,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stats" jsonb,
	"parsed_at" timestamp with time zone,
	CONSTRAINT "ownership_uploads_sha256" UNIQUE("sha256"),
	CONSTRAINT "ownership_uploads_month_check" CHECK ("ownership_uploads"."as_of_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "ownership_changes" ADD CONSTRAINT "ownership_changes_to_set_id_ownership_snapshot_sets_id_fk" FOREIGN KEY ("to_set_id") REFERENCES "public"."ownership_snapshot_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_changes" ADD CONSTRAINT "ownership_changes_from_set_id_ownership_snapshot_sets_id_fk" FOREIGN KEY ("from_set_id") REFERENCES "public"."ownership_snapshot_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_snapshot_rows" ADD CONSTRAINT "ownership_snapshot_rows_set_id_ownership_snapshot_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."ownership_snapshot_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_snapshot_sets" ADD CONSTRAINT "ownership_snapshot_sets_upload_id_ownership_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."ownership_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_snapshot_sets" ADD CONSTRAINT "ownership_snapshot_sets_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_uploads" ADD CONSTRAINT "ownership_uploads_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ownership_changes_month_symbol" ON "ownership_changes" USING btree ("month","symbol");--> statement-breakpoint
CREATE INDEX "ownership_changes_holder" ON "ownership_changes" USING btree ("holder_key");--> statement-breakpoint
CREATE INDEX "ownership_snapshot_rows_set" ON "ownership_snapshot_rows" USING btree ("set_id","line_no");--> statement-breakpoint
CREATE INDEX "ownership_snapshot_rows_holder" ON "ownership_snapshot_rows" USING btree ("holder_key");--> statement-breakpoint
CREATE INDEX "ownership_snapshot_sets_month" ON "ownership_snapshot_sets" USING btree ("month");--> statement-breakpoint
CREATE INDEX "ownership_snapshot_sets_upload" ON "ownership_snapshot_sets" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "ownership_uploads_received" ON "ownership_uploads" USING btree ("received_at");