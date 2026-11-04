CREATE TABLE "subscription" (
	"id" text PRIMARY KEY,
	"plan" text NOT NULL,
	"reference_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" text DEFAULT 'incomplete',
	"period_start" timestamp,
	"period_end" timestamp,
	"trial_start" timestamp,
	"trial_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false,
	"cancel_at" timestamp,
	"canceled_at" timestamp,
	"ended_at" timestamp,
	"seats" integer,
	"billing_interval" text,
	"stripe_schedule_id" text
);
--> statement-breakpoint
CREATE TABLE "organization_billing" (
	"organization_id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"personal" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "plan" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL CONSTRAINT "plan_name_unique" UNIQUE,
	"description" text DEFAULT '' NOT NULL,
	"monthly_price_id" text CONSTRAINT "plan_monthly_price_id_unique" UNIQUE,
	"yearly_price_id" text CONSTRAINT "plan_yearly_price_id_unique" UNIQUE,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"max_organizations" integer,
	"max_agents" integer,
	"max_forge_apps" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plan_prices" CHECK (case when "is_default"
        then "monthly_price_id" is null and "yearly_price_id" is null
        else "monthly_price_id" is not null end),
	CONSTRAINT "plan_limits_non_negative" CHECK (coalesce("max_organizations", 0) >= 0
        and coalesce("max_agents", 0) >= 0
        and coalesce("max_forge_apps", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "plan_price" (
	"price_id" text PRIMARY KEY,
	"plan_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "disabled_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "forge_app" ADD COLUMN "disabled_at" timestamp;--> statement-breakpoint
CREATE INDEX "subscription_referenceId_idx" ON "subscription" ("reference_id");--> statement-breakpoint
CREATE INDEX "organization_billing_userId_idx" ON "organization_billing" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_default_unique" ON "plan" ("is_default") WHERE "is_default";--> statement-breakpoint
CREATE INDEX "plan_price_planId_idx" ON "plan_price" ("plan_id");--> statement-breakpoint
ALTER TABLE "organization_billing" ADD CONSTRAINT "organization_billing_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_billing" ADD CONSTRAINT "organization_billing_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "plan_price" ADD CONSTRAINT "plan_price_plan_id_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE SET NULL;--> statement-breakpoint
-- Each organization's billing owner: its oldest owner, or oldest member if it has no owner.
INSERT INTO "organization_billing" ("organization_id", "user_id")
SELECT DISTINCT ON ("organization_id") "organization_id", "user_id"
FROM "member"
ORDER BY "organization_id", ("role" LIKE '%owner%') DESC, "created_at", "id";--> statement-breakpoint
-- Personal organizations, as created on users' first session.
UPDATE "organization_billing" SET "personal" = true
FROM "organization"
WHERE "organization"."id" = "organization_billing"."organization_id"
AND "organization"."slug" = 'personal-' || lower("organization_billing"."user_id");--> statement-breakpoint
-- The default plan, unlimited until an admin sets its limits.
INSERT INTO "plan" ("id", "name", "description", "is_default")
VALUES (gen_random_uuid()::text, 'Free', 'For everyone without a subscription', true);
