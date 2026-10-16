-- E3 market info. news_items had no writer before E3, so the NOT NULL title_key column is added to an empty table.
CREATE TABLE "macro_observations" (
	"series" text NOT NULL,
	"date" date NOT NULL,
	"value" numeric(18, 6) NOT NULL,
	"link" text,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"raw_ref" uuid,
	CONSTRAINT "macro_observations_pk" PRIMARY KEY("series","date")
);
--> statement-breakpoint
ALTER TABLE "news_items" ADD COLUMN "published_at_estimated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "news_items" ADD COLUMN "title_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "news_items" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "macro_observations" ADD CONSTRAINT "macro_observations_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "news_items_title_key" ON "news_items" USING btree ("title_key","published_at");--> statement-breakpoint
CREATE INDEX "news_items_symbols" ON "news_items" USING gin ("symbols");--> statement-breakpoint
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_summary_length" CHECK ("news_items"."summary" is null or char_length("news_items"."summary") <= 280);