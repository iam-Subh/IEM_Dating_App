-- App settings: per-category notification switches, and SMS consent.
ALTER TABLE "users" ADD COLUMN "notification_prefs" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "users" ADD COLUMN "sms_updates" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "sms_consent_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "sms_consent_version" VARCHAR(16);
