-- My preferences, made real (PREFERENCES_SPEC.md).
ALTER TABLE "users" ADD COLUMN "match_criteria" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "users" ADD COLUMN "flexible_age" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN "verified_only" BOOLEAN NOT NULL DEFAULT false;
