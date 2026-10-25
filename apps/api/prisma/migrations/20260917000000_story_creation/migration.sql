-- Story creation: background batches, interactive stickers, and music.
-- Additive only.

-- Stories carry their own length, the interactive part of their composition
-- (stickers and music, drawn live by the viewer), and where they came from.
ALTER TABLE "stories"
  ADD COLUMN "duration_ms" INTEGER,
  ADD COLUMN "composition" JSONB,
  ADD COLUMN "batch_id" UUID,
  ADD COLUMN "part_index" INTEGER,
  ADD COLUMN "part_count" INTEGER,
  ADD COLUMN "music_track_id" VARCHAR(64);

CREATE INDEX "stories_batch_id_idx" ON "stories" ("batch_id");

-- Story media can be uploaded in parts from the device's background worker.
ALTER TABLE "story_media_assets"
  ADD COLUMN "upload_id" VARCHAR(1024),
  ADD COLUMN "part_size" INTEGER,
  ADD COLUMN "part_count" INTEGER,
  ADD COLUMN "declared_bytes" BIGINT;

-- One Share action, posted in the background.
CREATE TABLE "story_batches" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'posting',
  "item_count" INTEGER NOT NULL,
  "session_version" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "story_batches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "story_batches_owner_id_status_idx" ON "story_batches" ("owner_id", "status");
CREATE INDEX "story_batches_status_updated_at_idx" ON "story_batches" ("status", "updated_at");

-- One item of a batch, published in position order.
CREATE TABLE "story_batch_items" (
  "id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "asset_id" UUID NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "duration_ms" INTEGER NOT NULL,
  "composition" JSONB NOT NULL,
  "part_index" INTEGER,
  "part_count" INTEGER,
  "status" VARCHAR(16) NOT NULL DEFAULT 'uploading',
  "story_id" UUID,
  "failure_reason" VARCHAR(200),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_batch_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_batch_items_batch_id_position_key" ON "story_batch_items" ("batch_id", "position");
CREATE UNIQUE INDEX "story_batch_items_asset_id_key" ON "story_batch_items" ("asset_id");

-- Interactive stickers, one row each, extracted from the composition.
CREATE TABLE "story_stickers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "story_id" UUID NOT NULL,
  "sticker_key" VARCHAR(64) NOT NULL,
  "type" VARCHAR(24) NOT NULL,
  "config" JSONB NOT NULL,
  "ends_at" TIMESTAMP(3),
  "notified_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_stickers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_stickers_story_id_sticker_key_key" ON "story_stickers" ("story_id", "sticker_key");
CREATE INDEX "story_stickers_type_ends_at_notified_at_idx" ON "story_stickers" ("type", "ends_at", "notified_at");

-- One vote, answer or rating per viewer per sticker.
CREATE TABLE "story_sticker_responses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sticker_id" UUID NOT NULL,
  "story_id" UUID NOT NULL,
  "viewer_id" UUID NOT NULL,
  "value" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_sticker_responses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_sticker_responses_sticker_id_viewer_id_key" ON "story_sticker_responses" ("sticker_id", "viewer_id");
CREATE INDEX "story_sticker_responses_story_id_idx" ON "story_sticker_responses" ("story_id");

-- Question sticker replies; a viewer may send several.
CREATE TABLE "story_question_replies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sticker_id" UUID NOT NULL,
  "story_id" UUID NOT NULL,
  "viewer_id" UUID NOT NULL,
  "text" VARCHAR(300) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_question_replies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "story_question_replies_sticker_id_created_at_idx" ON "story_question_replies" ("sticker_id", "created_at");

-- "Remind me" on countdown stickers.
CREATE TABLE "story_countdown_subscriptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sticker_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notified_at" TIMESTAMP(3),
  CONSTRAINT "story_countdown_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_countdown_subscriptions_sticker_id_user_id_key" ON "story_countdown_subscriptions" ("sticker_id", "user_id");

CREATE TABLE "story_mentions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "story_id" UUID NOT NULL,
  "mentioned_user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_mentions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_mentions_story_id_mentioned_user_id_key" ON "story_mentions" ("story_id", "mentioned_user_id");
CREATE INDEX "story_mentions_mentioned_user_id_idx" ON "story_mentions" ("mentioned_user_id");

CREATE TABLE "story_link_taps" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sticker_id" UUID NOT NULL,
  "story_id" UUID NOT NULL,
  "viewer_id" UUID NOT NULL,
  "tapped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_link_taps_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "story_link_taps_sticker_id_viewer_id_key" ON "story_link_taps" ("sticker_id", "viewer_id");

-- Snapshot of each song used in a Story.
CREATE TABLE "music_tracks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" VARCHAR(16) NOT NULL,
  "provider_track_id" VARCHAR(64) NOT NULL,
  "title" VARCHAR(300) NOT NULL,
  "artists" VARCHAR(500) NOT NULL,
  "album" VARCHAR(300),
  "duration_ms" INTEGER NOT NULL,
  "language" VARCHAR(40),
  "explicit" BOOLEAN NOT NULL DEFAULT false,
  "artwork_url" VARCHAR(1000),
  "source_url" VARCHAR(1000),
  "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "music_tracks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "music_tracks_provider_provider_track_id_key" ON "music_tracks" ("provider", "provider_track_id");

-- LRCLIB result per song, including "not found" so it is not asked every time.
CREATE TABLE "music_lyrics" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" VARCHAR(16) NOT NULL,
  "provider_track_id" VARCHAR(64) NOT NULL,
  "lrclib_id" INTEGER,
  "status" VARCHAR(16) NOT NULL,
  "lines" JSONB,
  "plain_text" TEXT,
  "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "music_lyrics_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "music_lyrics_provider_provider_track_id_key" ON "music_lyrics" ("provider", "provider_track_id");
