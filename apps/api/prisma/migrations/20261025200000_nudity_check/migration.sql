-- Nudity check (docs/NUDITY_CHECK.md): every uploaded photo and video gets a
-- score from Bumble's Private Detector; borderline ones wait for the team.
ALTER TABLE "profile_media_assets" ADD COLUMN "nudity_score" REAL;
ALTER TABLE "story_media_assets" ADD COLUMN "nudity_score" REAL;
ALTER TABLE "chat_media_assets" ADD COLUMN "nudity_score" REAL;
-- Chat: shown blurred to the receiver, with View and Report.
ALTER TABLE "chat_media_assets" ADD COLUMN "sensitive" BOOLEAN NOT NULL DEFAULT false;

-- What the team decides on: profile photos and videos, stories.
CREATE TABLE "media_moderations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "kind" VARCHAR(20) NOT NULL,
  "asset_id" UUID,
  "story_id" UUID,
  "object_key" VARCHAR(500),
  "media_url" VARCHAR(1000),
  "score" REAL,
  "status" VARCHAR(20) NOT NULL,
  "decided_by" UUID,
  "decided_at" TIMESTAMP(3),
  "note" VARCHAR(300),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_moderations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "media_moderations_status_created_at_idx" ON "media_moderations"("status", "created_at");
CREATE INDEX "media_moderations_user_id_created_at_idx" ON "media_moderations"("user_id", "created_at");
CREATE INDEX "media_moderations_media_url_idx" ON "media_moderations"("media_url");
