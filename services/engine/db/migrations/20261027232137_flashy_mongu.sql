CREATE TABLE "idx_issuer_profiles" (
	"symbol" text NOT NULL,
	"language" text NOT NULL,
	"profile" jsonb NOT NULL,
	"directors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commissioners" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audit_committee" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shareholders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subsidiaries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"raw_ref" uuid,
	CONSTRAINT "idx_issuer_profiles_pk" PRIMARY KEY("symbol","language")
);
--> statement-breakpoint
CREATE TABLE "idx_ratio_periods" (
	"symbol" text NOT NULL,
	"fs_date" date NOT NULL,
	"period_type" text NOT NULL,
	"fiscal_year_end" text,
	"sharia" text,
	"audit" text,
	"opinion" text,
	"metrics" jsonb NOT NULL,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"raw_ref" uuid,
	CONSTRAINT "idx_ratio_periods_pk" PRIMARY KEY("symbol","fs_date","period_type")
);
--> statement-breakpoint
ALTER TABLE "idx_issuer_profiles" ADD CONSTRAINT "idx_issuer_profiles_symbol_securities_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."securities"("symbol") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idx_issuer_profiles" ADD CONSTRAINT "idx_issuer_profiles_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idx_ratio_periods" ADD CONSTRAINT "idx_ratio_periods_symbol_securities_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."securities"("symbol") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idx_ratio_periods" ADD CONSTRAINT "idx_ratio_periods_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ratio_periods_date" ON "idx_ratio_periods" USING btree ("fs_date","symbol");