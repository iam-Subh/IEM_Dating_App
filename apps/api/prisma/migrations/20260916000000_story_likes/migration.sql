-- Private likes on Stories, as Instagram's heart: the author sees who liked a
-- Story in its viewer list, and no message is sent.
CREATE TABLE "story_likes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "story_id" UUID NOT NULL,
  "viewer_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_likes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "story_likes_story_id_viewer_id_key" ON "story_likes" ("story_id", "viewer_id");
CREATE INDEX "story_likes_viewer_id_story_id_idx" ON "story_likes" ("viewer_id", "story_id");
