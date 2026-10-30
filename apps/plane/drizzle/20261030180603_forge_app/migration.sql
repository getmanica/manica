CREATE TABLE "forge_app" (
	"id" text PRIMARY KEY,
	"forge" text NOT NULL,
	"external_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"install_url" text,
	"owner" text NOT NULL,
	"secrets" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "forge_app_forge_externalId_unique" UNIQUE("forge","external_id")
);
--> statement-breakpoint
CREATE TABLE "forge_app_setup" (
	"state" text PRIMARY KEY,
	"app_id" text NOT NULL,
	"forge" text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "forge_app_organizationId_idx" ON "forge_app" ("organization_id");--> statement-breakpoint
CREATE INDEX "forge_app_setup_userId_idx" ON "forge_app_setup" ("user_id");--> statement-breakpoint
ALTER TABLE "forge_app" ADD CONSTRAINT "forge_app_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "forge_app" ADD CONSTRAINT "forge_app_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "forge_app_setup" ADD CONSTRAINT "forge_app_setup_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "forge_app_setup" ADD CONSTRAINT "forge_app_setup_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;