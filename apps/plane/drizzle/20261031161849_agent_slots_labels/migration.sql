ALTER TABLE "agent" ADD COLUMN "slots" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "labels" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_slots_positive" CHECK ("slots" > 0);