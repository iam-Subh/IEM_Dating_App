-- Per-user conversation state, modelled on Telegram's dialog actions.
--
-- muted_until and archived_at already exist. A pin is a timestamp rather than a
-- flag because Telegram lists pinned chats newest-pinned first. Clearing history
-- and deleting a chat are recorded as a sequence watermark and a hide time
-- instead of deleting rows: this is a dating app with safety reporting, and a
-- user tidying their own list must never destroy evidence the other person
-- might later need to report.
ALTER TABLE "chat_participants"
  ADD COLUMN "pinned_at" TIMESTAMP(3),
  ADD COLUMN "marked_unread" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cleared_through_seq" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "hidden_at" TIMESTAMP(3);

CREATE INDEX "chat_participants_user_pinned_idx"
  ON "chat_participants" ("user_id", "pinned_at")
  WHERE "pinned_at" IS NOT NULL;

-- Disappearing messages are a property of the conversation, shared by both
-- participants, as in Telegram's private chats.
ALTER TABLE "matches"
  ADD COLUMN "message_ttl_seconds" INTEGER,
  ADD CONSTRAINT "matches_message_ttl_seconds_check"
    CHECK ("message_ttl_seconds" IS NULL OR "message_ttl_seconds" BETWEEN 60 AND 31622400);

-- Stamped at send time from the conversation's setting, so changing the setting
-- later never retroactively shortens or extends messages already sent.
ALTER TABLE "messages" ADD COLUMN "expires_at" TIMESTAMP(3);

-- The expiry sweeper only ever looks for live messages that have a deadline.
CREATE INDEX "messages_expires_at_pending_idx"
  ON "messages" ("expires_at")
  WHERE "expires_at" IS NOT NULL AND "is_deleted" = false;
