CREATE TYPE "agent_arch" AS ENUM('arm64', 'x86_64');--> statement-breakpoint
CREATE TYPE "agent_os" AS ENUM('linux', 'darwin', 'windows');--> statement-breakpoint
CREATE TABLE "agent" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"os" "agent_os" NOT NULL,
	"arch" "agent_arch" NOT NULL,
	"last_seen_at" timestamp,
	"organization_id" text NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_organizationId_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;