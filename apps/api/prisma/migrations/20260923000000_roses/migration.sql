-- Explore, phase E: Roses (EXPLORE_SPEC.md, section 10).
--
-- A Rose is a scarce, higher-priority Like. The grant is free for now and
-- tops the balance up to a ceiling each week rather than accumulating, so an
-- account dormant for two months comes back with a week's worth rather than
-- a spam budget.

ALTER TABLE "users" ADD COLUMN "roses" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "users" ADD COLUMN "roses_refreshed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "users" ADD CONSTRAINT "users_roses_check" CHECK ("roses" >= 0);

CREATE TABLE "roses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sender_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "swipe_id" UUID,
    "comment" VARCHAR(140),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roses_pkey" PRIMARY KEY ("id")
);

-- Likes You reads the recipient's Roses newest first.
CREATE INDEX "roses_recipient_id_created_at_idx" ON "roses"("recipient_id", "created_at" DESC);
-- The one-per-person-per-30-days limit reads the sender/recipient pair.
CREATE INDEX "roses_sender_id_recipient_id_created_at_idx" ON "roses"("sender_id", "recipient_id", "created_at" DESC);
