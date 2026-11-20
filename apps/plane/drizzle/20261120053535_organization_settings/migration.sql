CREATE TABLE "organization_settings" (
	"organization_id" text PRIMARY KEY,
	"metrics_retention_days" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_settings_metricsRetentionDays_range" CHECK ("metrics_retention_days" between 1 and 90)
);
--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;