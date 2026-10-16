CREATE TABLE "financials" (
	"symbol" text NOT NULL,
	"period_end" date NOT NULL,
	"period_type" text NOT NULL,
	"metric" text NOT NULL,
	"value" numeric(30, 6) NOT NULL,
	"unit" text NOT NULL,
	"currency" text,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"raw_ref" uuid,
	CONSTRAINT "financials_pk" PRIMARY KEY("symbol","period_end","period_type","metric","source"),
	CONSTRAINT "financials_period_type_check" CHECK ("financials"."period_type" in ('annual', 'quarterly')),
	CONSTRAINT "financials_unit_check" CHECK ("financials"."unit" in ('amount', 'per_share', 'shares'))
);
--> statement-breakpoint
CREATE TABLE "stock_ratios" (
	"symbol" text NOT NULL,
	"ratio" text NOT NULL,
	"ratio_source" text NOT NULL,
	"value" numeric(30, 10),
	"date" date NOT NULL,
	"basis" text NOT NULL,
	"note" text,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"derivation" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"raw_ref" uuid,
	CONSTRAINT "stock_ratios_pk" PRIMARY KEY("symbol","ratio","ratio_source"),
	CONSTRAINT "stock_ratios_ratio_source_check" CHECK ("stock_ratios"."ratio_source" in ('derived', 'pasardana'))
);
--> statement-breakpoint
ALTER TABLE "financials" ADD CONSTRAINT "financials_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ratios" ADD CONSTRAINT "stock_ratios_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financials_symbol_period" ON "financials" USING btree ("symbol","period_end");