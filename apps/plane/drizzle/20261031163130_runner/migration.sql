CREATE TYPE "runner_state" AS ENUM('registering', 'issued', 'acked', 'running', 'exited', 'released', 'lost');--> statement-breakpoint
CREATE TABLE "runner" (
	"id" text PRIMARY KEY,
	"agent_id" text NOT NULL,
	"forge_app_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"repository" text NOT NULL,
	"labels" text[] NOT NULL,
	"state" "runner_state" NOT NULL,
	"reserved_job_id" text,
	"job_id" text,
	"external_runner_id" text,
	"lease_expires_at" timestamp NOT NULL,
	"exit_code" integer,
	"cleanup_at" timestamp,
	"cleanup_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "runner_reservedJobId_live_unique" ON "runner" ("reserved_job_id") WHERE "state" in ('registering', 'issued', 'acked', 'running');--> statement-breakpoint
CREATE INDEX "runner_agentId_live_idx" ON "runner" ("agent_id") WHERE "state" in ('registering', 'issued', 'acked', 'running');--> statement-breakpoint
CREATE INDEX "runner_leaseExpiresAt_live_idx" ON "runner" ("lease_expires_at") WHERE "state" in ('registering', 'issued', 'acked', 'running');--> statement-breakpoint
CREATE INDEX "runner_cleanupAt_idx" ON "runner" ("cleanup_at") WHERE "cleanup_at" is not null;--> statement-breakpoint
CREATE INDEX "runner_forgeAppId_externalRunnerId_idx" ON "runner" ("forge_app_id","external_runner_id");--> statement-breakpoint
ALTER TABLE "runner" ADD CONSTRAINT "runner_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "runner" ADD CONSTRAINT "runner_forge_app_id_forge_app_id_fkey" FOREIGN KEY ("forge_app_id") REFERENCES "forge_app"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "runner" ADD CONSTRAINT "runner_reserved_job_id_job_id_fkey" FOREIGN KEY ("reserved_job_id") REFERENCES "job"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "runner" ADD CONSTRAINT "runner_job_id_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE SET NULL;