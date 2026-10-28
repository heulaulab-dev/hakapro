CREATE TABLE "broker_daily_summaries" (
	"date" date NOT NULL,
	"broker_code" text NOT NULL,
	"firm_name" text,
	"volume" bigint,
	"value" bigint,
	"frequency" bigint,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"raw_ref" uuid,
	CONSTRAINT "broker_daily_summaries_pk" PRIMARY KEY("date","broker_code")
);
--> statement-breakpoint
ALTER TABLE "broker_daily_summaries" ADD CONSTRAINT "broker_daily_summaries_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broker_daily_summaries_code_date" ON "broker_daily_summaries" USING btree ("broker_code","date");