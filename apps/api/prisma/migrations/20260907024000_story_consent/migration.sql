ALTER TABLE "users"
  ADD COLUMN "stories_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "allow_follow_requests" BOOLEAN NOT NULL DEFAULT false;
