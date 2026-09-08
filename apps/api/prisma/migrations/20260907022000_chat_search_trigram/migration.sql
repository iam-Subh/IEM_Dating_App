CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "messages_content_trgm_idx"
  ON "messages" USING GIN ("content" gin_trgm_ops)
  WHERE "is_deleted" = false;
