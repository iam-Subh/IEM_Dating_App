-- Google sign-in (apps/mobile/src/features/auth/GOOGLE_SIGNUP_PLAN.md).
ALTER TABLE "users" ADD COLUMN "google_sub" VARCHAR(255);
ALTER TABLE "users" ADD COLUMN "google_email" VARCHAR(255);
ALTER TABLE "users" ADD COLUMN "google_linked_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");
