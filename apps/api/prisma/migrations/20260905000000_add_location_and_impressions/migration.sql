-- AlterTable
ALTER TABLE "users" ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "location_consent_at" TIMESTAMP(3),
ADD COLUMN     "location_updated_at" TIMESTAMP(3),
ADD COLUMN     "longitude" DECIMAL(9,6);

-- CreateTable
CREATE TABLE "profile_impressions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "viewer_id" UUID NOT NULL,
    "shown_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "best_position" INTEGER,
    "acted" BOOLEAN NOT NULL DEFAULT false,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_impressions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "profile_impressions_shown_id_day_idx" ON "profile_impressions"("shown_id", "day");

-- CreateIndex
CREATE INDEX "profile_impressions_viewer_id_day_idx" ON "profile_impressions"("viewer_id", "day");

-- CreateIndex
CREATE INDEX "profile_impressions_day_idx" ON "profile_impressions"("day");

-- CreateIndex
CREATE UNIQUE INDEX "profile_impressions_viewer_id_shown_id_day_key" ON "profile_impressions"("viewer_id", "shown_id", "day");

-- CreateIndex
CREATE INDEX "users_latitude_longitude_idx" ON "users"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "users_is_active_gender_seeking_last_active_at_idx" ON "users"("is_active", "gender", "seeking", "last_active_at");

