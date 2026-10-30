CREATE TYPE "job_status" AS ENUM('queued', 'in_progress', 'completed');--> statement-breakpoint
CREATE TABLE "job" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"forge_app_id" text NOT NULL,
	"external_id" text NOT NULL,
	"run_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"repository" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"labels" text[] NOT NULL,
	"status" "job_status" NOT NULL,
	"conclusion" text,
	"external_runner_id" text,
	"runner_name" text,
	"queued_at" timestamp NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "job_forgeAppId_externalId_unique" UNIQUE("forge_app_id","external_id")
);
--> statement-breakpoint
CREATE INDEX "job_organizationId_queuedAt_idx" ON "job" ("organization_id","queued_at");--> statement-breakpoint
CREATE INDEX "job_queued_idx" ON "job" ("organization_id","queued_at") WHERE "status" = 'queued';--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_forge_app_id_forge_app_id_fkey" FOREIGN KEY ("forge_app_id") REFERENCES "forge_app"("id") ON DELETE CASCADE;