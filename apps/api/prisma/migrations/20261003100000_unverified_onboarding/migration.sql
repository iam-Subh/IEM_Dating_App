-- Onboarding for unverified Google accounts (apps/mobile/src/features/auth/GOOGLE_SIGNUP_PLAN.md 1.3).
ALTER TABLE "users" ADD COLUMN "claimed_institution_id" UUID;
ALTER TABLE "users" ADD COLUMN "verify_later_at" TIMESTAMP(3);
ALTER TABLE "users" ADD CONSTRAINT "users_claimed_institution_id_fkey" FOREIGN KEY ("claimed_institution_id") REFERENCES "institutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
