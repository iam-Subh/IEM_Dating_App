-- Sign-up is college email or Google only: phone numbers and texts are gone.
ALTER TABLE "users" DROP COLUMN IF EXISTS "phone";
ALTER TABLE "users" DROP COLUMN IF EXISTS "phone_verified_at";
ALTER TABLE "users" DROP COLUMN IF EXISTS "sms_updates";
ALTER TABLE "users" DROP COLUMN IF EXISTS "sms_consent_at";
ALTER TABLE "users" DROP COLUMN IF EXISTS "sms_consent_version";
