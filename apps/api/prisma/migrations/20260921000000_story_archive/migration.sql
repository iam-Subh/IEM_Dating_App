-- Stories, Part 3: Archive, Insights, saving, and the lifecycle that removes
-- old data. No Highlights — deliberately not built (STORY_ARCHIVE_SPEC.md).

-- Per-person controls, defaulting to Instagram's own defaults: keep everything
-- you post, but don't auto-save a copy to the gallery.
ALTER TABLE "users" ADD COLUMN "story_archive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN "story_save_to_gallery" BOOLEAN NOT NULL DEFAULT false;

-- Whether this Story goes to the owner's Archive when it ends, copied from the
-- setting above at posting time, so a later settings change never rewrites history.
ALTER TABLE "stories" ADD COLUMN "archive" BOOLEAN NOT NULL DEFAULT true;
-- Set 48 hours after publishedAt, once the viewer list and likes are frozen into
-- story_insights and their rows removed.
ALTER TABLE "stories" ADD COLUMN "viewers_closed_at" TIMESTAMP(3);
-- Set when the story's media is deleted from storage: either it ended without
-- being archived, or it was deleted outright.
ALTER TABLE "stories" ADD COLUMN "purged_at" TIMESTAMP(3);

-- 'purged' joins the existing 'published' and 'deleted' states.
ALTER TABLE "stories" ADD CONSTRAINT "stories_state_check"
    CHECK ("state" IN ('published', 'deleted', 'purged'));

-- The Archive grid reads a person's ended, archived stories newest first.
CREATE INDEX "stories_owner_id_state_expires_at_id_idx"
    ON "stories"("owner_id", "state", "expires_at" DESC, "id");
-- The 48-hour freeze job scans for stories that have ended and aren't yet closed.
CREATE INDEX "stories_viewers_closed_at_expires_at_idx"
    ON "stories"("viewers_closed_at", "expires_at");

-- Totals for one Story. Nobody, including the owner, can see who produced them
-- - only the counts. Populated by insight events while live, and by the freeze
-- job (reach, likes, sticker_taps) at 48 hours.
CREATE TABLE "story_insights" (
    "story_id" UUID NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "forward_taps" INTEGER NOT NULL DEFAULT 0,
    "back_taps" INTEGER NOT NULL DEFAULT 0,
    "next_story" INTEGER NOT NULL DEFAULT 0,
    "exits" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "reactions" INTEGER NOT NULL DEFAULT 0,
    "profile_visits" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER,
    "likes" INTEGER,
    "sticker_taps" INTEGER,

    CONSTRAINT "story_insights_pkey" PRIMARY KEY ("story_id")
);

ALTER TABLE "story_insights" ADD CONSTRAINT "story_insights_counts_check"
    CHECK ("views" >= 0 AND "forward_taps" >= 0 AND "back_taps" >= 0 AND "next_story" >= 0
        AND "exits" >= 0 AND "replies" >= 0 AND "reactions" >= 0 AND "profile_visits" >= 0
        AND ("reach" IS NULL OR "reach" >= 0) AND ("likes" IS NULL OR "likes" >= 0)
        AND ("sticker_taps" IS NULL OR "sticker_taps" >= 0));
