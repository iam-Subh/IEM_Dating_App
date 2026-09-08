CREATE TABLE "profile_media_assets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_id" UUID NOT NULL,
  "object_key" VARCHAR(500) NOT NULL,
  "purpose" VARCHAR(24) NOT NULL,
  "content_type" VARCHAR(100) NOT NULL,
  "max_bytes" INTEGER NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'requested',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "attached_at" TIMESTAMP(3),
  CONSTRAINT "profile_media_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "profile_media_assets_object_key_key" ON "profile_media_assets"("object_key");
CREATE INDEX "profile_media_assets_owner_id_status_idx" ON "profile_media_assets"("owner_id", "status");
