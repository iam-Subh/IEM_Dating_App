CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "topic" VARCHAR(80) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "deduplication_key" VARCHAR(255) NOT NULL,
  "payload_version" INTEGER NOT NULL DEFAULT 1,
  "payload" JSONB NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "locked_by" VARCHAR(100),
  "last_error" VARCHAR(500),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbox_events_status_check" CHECK ("status" IN ('pending', 'processing', 'completed', 'dead')),
  CONSTRAINT "outbox_events_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "outbox_events_payload_version_check" CHECK ("payload_version" > 0)
);

CREATE UNIQUE INDEX "outbox_events_deduplication_key_key" ON "outbox_events"("deduplication_key");
CREATE INDEX "outbox_events_status_available_at_created_at_idx" ON "outbox_events"("status", "available_at", "created_at");
CREATE INDEX "outbox_events_aggregate_id_idx" ON "outbox_events"("aggregate_id");

ALTER TABLE "notifications" ADD COLUMN "delivery_key" VARCHAR(255);
ALTER TABLE "notifications" ADD COLUMN "outbox_event_id" UUID;
CREATE UNIQUE INDEX "notifications_delivery_key_key" ON "notifications"("delivery_key");
CREATE INDEX "notifications_outbox_event_id_idx" ON "notifications"("outbox_event_id");
