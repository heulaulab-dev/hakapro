ALTER TABLE "corporate_actions" ADD COLUMN "source_category" text;--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD COLUMN "shares" bigint;--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD COLUMN "shares_after" bigint;