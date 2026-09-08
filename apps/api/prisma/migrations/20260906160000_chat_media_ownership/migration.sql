CREATE TABLE "chat_media_assets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "match_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "object_key" VARCHAR(500) NOT NULL,
  "content_type" VARCHAR(100) NOT NULL,
  "max_bytes" INTEGER NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'requested',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "attached_at" TIMESTAMP(3),
  CONSTRAINT "chat_media_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_media_assets_object_key_key" ON "chat_media_assets"("object_key");
CREATE INDEX "chat_media_assets_match_id_status_idx" ON "chat_media_assets"("match_id", "status");
CREATE INDEX "chat_media_assets_owner_id_status_idx" ON "chat_media_assets"("owner_id", "status");

INSERT INTO "chat_media_assets" ("match_id", "owner_id", "object_key", "content_type", "max_bytes", "status", "expires_at", "attached_at")
SELECT DISTINCT m."match_id", m."sender_id", keys."object_key", 'application/octet-stream', 52428800, 'attached', m."sent_at" + INTERVAL '365 days', m."sent_at"
FROM "messages" m
CROSS JOIN LATERAL unnest(array_remove(m."media_keys" || ARRAY[m."photo_url"], NULL)) keys("object_key")
WHERE keys."object_key" LIKE 'chat-media/%'
ON CONFLICT ("object_key") DO NOTHING;
