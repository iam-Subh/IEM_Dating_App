-- "Who can find me by name" (apps/mobile/src/features/auth/GOOGLE_SIGNUP_PLAN.md, Search): verified students only by default.
ALTER TABLE "users" ADD COLUMN "search_by_unverified" BOOLEAN NOT NULL DEFAULT false;
