ALTER TABLE "profile_media_assets"
  ADD COLUMN "preview_object_key" VARCHAR(500),
  ADD COLUMN "processing_status" VARCHAR(24) NOT NULL DEFAULT 'not_required',
  ADD COLUMN "processing_error" VARCHAR(500),
  ADD COLUMN "processed_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "profile_media_assets_preview_object_key_key"
  ON "profile_media_assets"("preview_object_key");

UPDATE "profile_media_assets"
SET "processing_status" = 'pending'
WHERE "purpose" = 'video'
  AND "status" = 'attached';

INSERT INTO "outbox_events" (
  "id",
  "topic",
  "aggregate_id",
  "deduplication_key",
  "payload_version",
  "payload",
  "status",
  "attempts",
  "available_at",
  "created_at"
)
SELECT
  gen_random_uuid(),
  'profile.video-preview.requested',
  asset."id",
  'profile.video-preview.requested:' || asset."id"::text,
  1,
  jsonb_build_object('assetId', asset."id", 'ownerId', asset."owner_id"),
  'pending',
  0,
  NOW(),
  NOW()
FROM "profile_media_assets" AS asset
WHERE asset."purpose" = 'video'
  AND asset."status" = 'attached'
ON CONFLICT ("deduplication_key") DO NOTHING;
