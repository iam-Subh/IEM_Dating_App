-- A person can hide their follower and following counts from Search (SEARCH_SPEC.md 5.1).
ALTER TABLE "users" ADD COLUMN "show_follower_count" BOOLEAN NOT NULL DEFAULT true;
