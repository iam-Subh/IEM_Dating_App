-- Add Yours: a prompt that others answer with their own story.
CREATE TABLE "story_add_yours_threads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "creator_id" UUID NOT NULL,
    "source_key" VARCHAR(140) NOT NULL,
    "prompt" VARCHAR(80) NOT NULL,
    "music" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_add_yours_threads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "story_add_yours_threads_source_key_key" ON "story_add_yours_threads"("source_key");
CREATE INDEX "story_add_yours_threads_creator_id_idx" ON "story_add_yours_threads"("creator_id");

CREATE TABLE "story_add_yours_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "thread_id" UUID NOT NULL,
    "story_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_add_yours_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "story_add_yours_entries_thread_id_story_id_key" ON "story_add_yours_entries"("thread_id", "story_id");
CREATE INDEX "story_add_yours_entries_thread_id_created_at_idx" ON "story_add_yours_entries"("thread_id", "created_at");
CREATE INDEX "story_add_yours_entries_owner_id_idx" ON "story_add_yours_entries"("owner_id");
