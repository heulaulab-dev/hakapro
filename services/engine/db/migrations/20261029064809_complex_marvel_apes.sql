CREATE TABLE "ksei_cash_dividend_notices" (
	"notice_id" text NOT NULL,
	"supersedes_notice_id" text,
	"symbol" text,
	"issuer" text,
	"amount_per_share" numeric(20, 6),
	"cum_date" date,
	"ex_date" date,
	"record_date" date,
	"payment_date" date,
	"status" text NOT NULL,
	"notice_date" date,
	"document_url" text NOT NULL,
	"document_sha256" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_ref" uuid,
	CONSTRAINT "ksei_cash_dividend_notice_pk" PRIMARY KEY("notice_id","document_sha256")
);
--> statement-breakpoint
ALTER TABLE "ksei_cash_dividend_notices" ADD CONSTRAINT "ksei_cash_dividend_notices_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ksei_cash_dividend_symbol_ex_date" ON "ksei_cash_dividend_notices" USING btree ("symbol","ex_date");--> statement-breakpoint
CREATE INDEX "ksei_cash_dividend_supersedes" ON "ksei_cash_dividend_notices" USING btree ("supersedes_notice_id");