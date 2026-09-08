ALTER TABLE "users"
  ADD COLUMN "last_account_event_seq" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "chat_device_cursors" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "device_id" VARCHAR(100) NOT NULL,
  "match_id" UUID NOT NULL,
  "last_applied_event_seq" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_device_cursors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "chat_device_cursors_user_id_device_id_match_id_key" ON "chat_device_cursors"("user_id", "device_id", "match_id");
CREATE INDEX "chat_device_cursors_user_id_device_id_updated_at_idx" ON "chat_device_cursors"("user_id", "device_id", "updated_at");

CREATE TABLE "account_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "account_seq" INTEGER NOT NULL,
  "type" VARCHAR(40) NOT NULL,
  "match_id" UUID,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "account_events_user_id_account_seq_key" ON "account_events"("user_id", "account_seq");
CREATE INDEX "account_events_user_id_created_at_idx" ON "account_events"("user_id", "created_at");

CREATE TABLE "delivery_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "outbox_event_id" UUID NOT NULL,
  "channel" VARCHAR(20) NOT NULL,
  "device_id" UUID NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "provider_ticket" VARCHAR(255),
  "last_error" VARCHAR(500),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "delivery_attempts_outbox_event_id_channel_device_id_key" ON "delivery_attempts"("outbox_event_id", "channel", "device_id");
CREATE INDEX "delivery_attempts_status_updated_at_idx" ON "delivery_attempts"("status", "updated_at");
