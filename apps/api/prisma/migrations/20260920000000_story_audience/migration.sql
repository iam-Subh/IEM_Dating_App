-- Stories, Part 2: who can see a story, and who can respond to it.

-- Per-person controls. Defaults keep today's behaviour: replies from matches,
-- mentions from anyone allowed to mention, resharing on.
ALTER TABLE "users" ADD COLUMN "story_replies" VARCHAR(16) NOT NULL DEFAULT 'matches';
ALTER TABLE "users" ADD COLUMN "story_mentions" VARCHAR(16) NOT NULL DEFAULT 'everyone';
ALTER TABLE "users" ADD COLUMN "story_resharing" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN "story_screenshot_block" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "users" ADD CONSTRAINT "users_story_replies_check"
    CHECK ("story_replies" IN ('matches', 'close_friends', 'off'));
ALTER TABLE "users" ADD CONSTRAINT "users_story_mentions_check"
    CHECK ("story_mentions" IN ('everyone', 'following', 'off'));

-- A story goes to your audience (followers and matches) or to close friends only.
ALTER TABLE "stories" ADD CONSTRAINT "stories_audience_check"
    CHECK ("audience" IN ('followers', 'close_friends'));

-- A background batch remembers its audience until each item publishes.
ALTER TABLE "story_batches" ADD COLUMN "audience" VARCHAR(20) NOT NULL DEFAULT 'followers';
ALTER TABLE "story_batches" ADD CONSTRAINT "story_batches_audience_check"
    CHECK ("audience" IN ('followers', 'close_friends'));

-- The Close Friends list. Private to its owner; nobody is told they are on it.
CREATE TABLE "story_close_friends" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "friend_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_close_friends_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "story_close_friends_owner_id_friend_id_key" ON "story_close_friends"("owner_id", "friend_id");
-- Reading a tray asks "whose close friend am I?", so the friend side is indexed too.
CREATE INDEX "story_close_friends_friend_id_idx" ON "story_close_friends"("friend_id");

-- People your stories are hidden from. They are never told.
CREATE TABLE "story_hidden_from" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "hidden_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_hidden_from_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "story_hidden_from_owner_id_hidden_user_id_key" ON "story_hidden_from"("owner_id", "hidden_user_id");
CREATE INDEX "story_hidden_from_hidden_user_id_idx" ON "story_hidden_from"("hidden_user_id");
