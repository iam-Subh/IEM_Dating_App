-- Standouts v3 (apps/mobile/src/features/discovery/STANDOUTS_PLAN.md).
-- Roses: new accounts start at the new weekly grant; existing balances are kept.
ALTER TABLE "users" ALTER COLUMN "roses" SET DEFAULT 5;
ALTER TABLE "users" ADD COLUMN "welcome_roses_at" TIMESTAMP(3);

ALTER TABLE "standout_days" ADD COLUMN "slots" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "standout_days" ADD COLUMN "taste" JSONB;
ALTER TABLE "standout_days" ADD COLUMN "version" VARCHAR(8) NOT NULL DEFAULT 'v2';

CREATE TABLE "standout_runs" (
  "day" VARCHAR(10) NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  "mode" VARCHAR(8) NOT NULL,
  "viewers" INTEGER NOT NULL DEFAULT 0,
  "sets" INTEGER NOT NULL DEFAULT 0,
  "short_sets" INTEGER NOT NULL DEFAULT 0,
  "relaxed" INTEGER NOT NULL DEFAULT 0,
  "duration_ms" INTEGER NOT NULL DEFAULT 0,
  "limits" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "standout_runs_pkey" PRIMARY KEY ("day")
);

CREATE TABLE "standout_shadow" (
  "viewer_id" UUID NOT NULL,
  "day" VARCHAR(10) NOT NULL,
  "picks" UUID[],
  "slots" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  CONSTRAINT "standout_shadow_pkey" PRIMARY KEY ("viewer_id", "day")
);

-- Roses received today, for the receive limit (STANDOUTS_PLAN.md 4.2).
CREATE INDEX IF NOT EXISTS "roses_recipient_created_idx" ON "roses" ("recipient_id", "created_at");
