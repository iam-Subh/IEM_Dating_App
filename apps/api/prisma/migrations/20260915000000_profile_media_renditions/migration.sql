-- Renditions for profile media.
--
-- Discovery used to serve every profile photo as its original upload (up to
-- 15 MB, with whatever metadata the camera wrote) and every profile video as
-- the uploaded file. Photos now get a card-sized and a thumbnail rendition,
-- and videos a poster frame and an H.264 playback rendition that starts
-- streaming immediately. Originals are kept.
ALTER TABLE "profile_photos"
  ADD COLUMN "card_url" VARCHAR(500),
  ADD COLUMN "thumb_url" VARCHAR(500);

ALTER TABLE "profile_media_assets"
  ADD COLUMN "card_object_key" VARCHAR(500),
  ADD COLUMN "thumb_object_key" VARCHAR(500),
  ADD COLUMN "poster_object_key" VARCHAR(500),
  ADD COLUMN "playback_object_key" VARCHAR(500);

ALTER TABLE "users"
  ADD COLUMN "video_poster_url" VARCHAR(500),
  ADD COLUMN "video_playback_url" VARCHAR(500);
