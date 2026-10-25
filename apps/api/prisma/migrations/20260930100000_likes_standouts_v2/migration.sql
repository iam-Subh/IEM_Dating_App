-- Likes You and Standouts, second version (STANDOUTS_LIKES_SPEC.md).
ALTER TABLE "users" ADD COLUMN "likes_seen_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "notify_likes" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN "likes_pushed_at" TIMESTAMP(3);

CREATE TABLE "standout_days" (
    "viewer_id" UUID NOT NULL,
    "day" VARCHAR(10) NOT NULL,
    "picks" UUID[],
    "hidden" UUID[] DEFAULT ARRAY[]::UUID[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "standout_days_pkey" PRIMARY KEY ("viewer_id", "day")
);
CREATE INDEX "standout_days_day_idx" ON "standout_days"("day");
-- Exposure is counted from the rows: how many readers' sets hold a person today.
CREATE INDEX "standout_days_picks_idx" ON "standout_days" USING GIN ("picks");
