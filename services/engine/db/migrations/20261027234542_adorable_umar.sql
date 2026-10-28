CREATE TABLE "idx_broker_members" (
	"broker_code" text PRIMARY KEY NOT NULL,
	"firm_name" text NOT NULL,
	"license" text,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"raw_ref" uuid
);
--> statement-breakpoint
ALTER TABLE "idx_broker_members" ADD CONSTRAINT "idx_broker_members_raw_ref_raw_documents_id_fk" FOREIGN KEY ("raw_ref") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;