-- Message notifications (apps/mobile/src/features/notifications/MESSAGE_NOTIFICATIONS_PLAN.md)

-- What each phone's app can do: "chat_v2" draws chat notifications itself.
ALTER TABLE "device_tokens" ADD COLUMN "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- A voice note was listened to (the sender's blue microphone).
ALTER TABLE "message_receipts" ADD COLUMN "played_at" TIMESTAMP(3);
