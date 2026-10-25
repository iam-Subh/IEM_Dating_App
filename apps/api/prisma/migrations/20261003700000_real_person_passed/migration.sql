-- Passed the real-person check at least once: the 14-day rule reads this, not the current status
-- (PHOTO_VERIFICATION_PLAN.md 5) - a photo changed later pauses only the status, never the profile.
ALTER TABLE "users" ADD COLUMN "real_person_passed_at" TIMESTAMP(3);
UPDATE "users" SET "real_person_passed_at" = "real_person_verified_at" WHERE "real_person_verified_at" IS NOT NULL;
