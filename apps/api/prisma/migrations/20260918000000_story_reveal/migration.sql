-- Viewers who unblurred a Reveal story by messaging its owner.
CREATE TABLE "story_reveal_unlocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "story_id" UUID NOT NULL,
    "viewer_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_reveal_unlocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "story_reveal_unlocks_story_id_viewer_id_key" ON "story_reveal_unlocks"("story_id", "viewer_id");
CREATE INDEX "story_reveal_unlocks_viewer_id_idx" ON "story_reveal_unlocks"("viewer_id");
