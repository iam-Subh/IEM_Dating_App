-- Which version of the Terms and Privacy Policy each person agreed to, and when (SAFETY_AND_LEGAL.md 6).
ALTER TABLE "users" ADD COLUMN "terms_version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" TIMESTAMP(3);
