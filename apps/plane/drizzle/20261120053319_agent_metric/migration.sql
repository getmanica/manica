CREATE TABLE "agent_metric" (
	"agent_id" text,
	"recorded_at" timestamp,
	"cpu" real NOT NULL,
	"memory_used" bigint NOT NULL,
	"memory_total" bigint NOT NULL,
	"disk_used" bigint NOT NULL,
	"disk_total" bigint NOT NULL,
	CONSTRAINT "agent_metric_pkey" PRIMARY KEY("agent_id","recorded_at")
);
--> statement-breakpoint
CREATE INDEX "agent_metric_recordedAt_idx" ON "agent_metric" ("recorded_at");--> statement-breakpoint
ALTER TABLE "agent_metric" ADD CONSTRAINT "agent_metric_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;