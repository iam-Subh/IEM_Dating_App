-- Stories, Part 3 (Phase B): Insights and reaction/reply rows in Activity.
-- story_insights itself was already created in 20260921000000_story_archive;
-- this only adds the index the Activity sheet's per-viewer reaction/reply
-- lookup needs (StoryService.viewersPage). Partial, since most messages have
-- no story_id at all - maintained here rather than in schema.prisma, the same
-- pattern already used for the discovery indexes (see schema.prisma comment).
CREATE INDEX "messages_story_id_sender_id_sent_at_idx"
    ON "messages" ("story_id", "sender_id", "sent_at" DESC)
    WHERE "story_id" IS NOT NULL;
