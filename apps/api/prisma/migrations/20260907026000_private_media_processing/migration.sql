ALTER TABLE "chat_media_assets"
  ADD COLUMN "detected_type" VARCHAR(100),
  ADD COLUMN "thumbnail_object_key" VARCHAR(500),
  ADD COLUMN "waveform" JSONB,
  ADD COLUMN "processed_at" TIMESTAMP(3);

ALTER TABLE "story_media_assets"
  ADD COLUMN "thumbnail_object_key" VARCHAR(500);
