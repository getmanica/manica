CREATE TABLE "plan_grant" (
	"user_id" text PRIMARY KEY,
	"plan_id" text NOT NULL,
	"expires_at" timestamp,
	"reason" text,
	"granted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "plan_grant_planId_idx" ON "plan_grant" ("plan_id");--> statement-breakpoint
ALTER TABLE "plan_grant" ADD CONSTRAINT "plan_grant_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "plan_grant" ADD CONSTRAINT "plan_grant_plan_id_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id");--> statement-breakpoint
ALTER TABLE "plan_grant" ADD CONSTRAINT "plan_grant_granted_by_user_id_fkey" FOREIGN KEY ("granted_by") REFERENCES "user"("id") ON DELETE SET NULL;