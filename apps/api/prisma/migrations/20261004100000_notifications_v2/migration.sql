-- Notifications v2 (apps/mobile/src/features/notifications/NOTIFICATIONS_PLAN.md)

-- Every push sent: opened or not, which line - open rates and back-off.
CREATE TABLE "push_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "template" VARCHAR(80),
    "spicy" BOOLEAN NOT NULL DEFAULT false,
    "notification_id" UUID,
    "dedupe_key" VARCHAR(255),
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_at" TIMESTAMPTZ(6),
    "opened_action" VARCHAR(40),
    "turned_off_at" TIMESTAMPTZ(6),
    CONSTRAINT "push_log_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "push_log_dedupe_key_key" ON "push_log"("dedupe_key");
CREATE INDEX "push_log_user_id_sent_at_idx" ON "push_log"("user_id", "sent_at");
CREATE INDEX "push_log_kind_sent_at_idx" ON "push_log"("kind", "sent_at");

-- Pushes held back by quiet hours.
CREATE TABLE "push_queue" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "send_after" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "push_queue_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "push_queue_send_after_idx" ON "push_queue"("send_after");
CREATE INDEX "push_queue_user_id_idx" ON "push_queue"("user_id");

-- When each person uses the app, and how far the timed pushes have gone.
CREATE TABLE "push_engagement" (
    "user_id" UUID NOT NULL,
    "active_hours" INTEGER[] DEFAULT ARRAY[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]::INTEGER[],
    "best_hour" SMALLINT,
    "comeback_level" SMALLINT NOT NULL DEFAULT 0,
    "spicy_paused_until" TIMESTAMPTZ(6),
    "last_standouts_at" TIMESTAMPTZ(6),
    "last_new_people_at" TIMESTAMPTZ(6),
    "last_tip_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "push_engagement_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "push_log" ADD CONSTRAINT "push_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_queue" ADD CONSTRAINT "push_queue_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_engagement" ADD CONSTRAINT "push_engagement_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
