-- Encrypted chat pushes (MESSAGE_NOTIFICATIONS_PLAN.md 11): each phone's key, sealed with the server's secret.
ALTER TABLE "device_tokens" ADD COLUMN "push_key" VARCHAR(200);
