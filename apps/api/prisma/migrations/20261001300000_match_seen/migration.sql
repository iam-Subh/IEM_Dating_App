-- When each person first opened a match: the "new" dot in New matches.
ALTER TABLE "matches" ADD COLUMN "user1_seen_at" TIMESTAMP(3);
ALTER TABLE "matches" ADD COLUMN "user2_seen_at" TIMESTAMP(3);
