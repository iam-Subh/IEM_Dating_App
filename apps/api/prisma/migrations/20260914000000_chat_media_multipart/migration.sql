-- Resumable uploads for large chat media.
--
-- A single presigned PUT has to finish inside its signature window, which a
-- 500 MB video on a campus connection cannot promise, and it restarts from zero
-- after any drop. Multipart uploads let the device send independent parts, keep
-- the ones that landed, and resume from the device's background uploader.
ALTER TABLE "chat_media_assets"
  ADD COLUMN "upload_id" VARCHAR(1024),
  ADD COLUMN "part_size" INTEGER,
  ADD COLUMN "part_count" INTEGER,
  ADD COLUMN "declared_bytes" BIGINT;

-- The sweeper looks up abandoned multipart uploads so S3 stops billing for
-- their stored parts.
CREATE INDEX "chat_media_assets_multipart_expiry_idx"
  ON "chat_media_assets" ("expires_at")
  WHERE "upload_id" IS NOT NULL;
