CREATE TABLE "scan_candidates" (
	"run_id" uuid NOT NULL,
	"strategy_id" text NOT NULL,
	"symbol" text NOT NULL,
	"session_date" date NOT NULL,
	"rules_version" text NOT NULL,
	"rank" integer NOT NULL,
	"name" text,
	"reasons" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	CONSTRAINT "scan_candidates_pk" PRIMARY KEY("run_id","strategy_id","symbol")
);
--> statement-breakpoint
CREATE TABLE "scan_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_date" date NOT NULL,
	"rules_version" text NOT NULL,
	"status" text NOT NULL,
	"skip_reason" text,
	"parameters" jsonb NOT NULL,
	"covered" integer DEFAULT 0 NOT NULL,
	"eligible" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"gate_failures" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"misses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"job_run_id" uuid,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	CONSTRAINT "scan_runs_session_rules" UNIQUE("session_date","rules_version")
);
--> statement-breakpoint
ALTER TABLE "scan_candidates" ADD CONSTRAINT "scan_candidates_run_id_scan_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_job_run_id_fetch_runs_id_fk" FOREIGN KEY ("job_run_id") REFERENCES "public"."fetch_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scan_candidates_session_strategy" ON "scan_candidates" USING btree ("session_date","strategy_id");--> statement-breakpoint
CREATE INDEX "scan_runs_status_session" ON "scan_runs" USING btree ("status","session_date");