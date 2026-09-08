-- DropForeignKey
ALTER TABLE "chat_sessions" DROP CONSTRAINT "chat_sessions_match_id_fkey";

-- DropForeignKey
ALTER TABLE "match_preferences" DROP CONSTRAINT "match_preferences_match_id_fkey";

-- DropForeignKey
ALTER TABLE "match_preferences" DROP CONSTRAINT "match_preferences_user_id_fkey";

-- DropForeignKey
ALTER TABLE "matches" DROP CONSTRAINT "matches_user1_id_fkey";

-- DropForeignKey
ALTER TABLE "matches" DROP CONSTRAINT "matches_user2_id_fkey";

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_match_id_fkey";

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_sender_id_fkey";

-- DropForeignKey
ALTER TABLE "profile_photos" DROP CONSTRAINT "profile_photos_user_id_fkey";

-- DropForeignKey
ALTER TABLE "safety_reports" DROP CONSTRAINT "safety_reports_match_id_fkey";

-- DropForeignKey
ALTER TABLE "safety_reports" DROP CONSTRAINT "safety_reports_reported_user_id_fkey";

-- DropForeignKey
ALTER TABLE "safety_reports" DROP CONSTRAINT "safety_reports_reporter_id_fkey";

-- DropForeignKey
ALTER TABLE "user_sessions" DROP CONSTRAINT "user_sessions_user_id_fkey";

-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "compatibility_score" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "hidden_by" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "media_keys" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "profile_photos" ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "attendance_mood" VARCHAR(100),
ADD COLUMN     "avatar_url" VARCHAR(500),
ADD COLUMN     "campus" VARCHAR(255),
ADD COLUMN     "clubs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "college" VARCHAR(255),
ADD COLUMN     "degree" VARCHAR(255),
ADD COLUMN     "distance_preference" INTEGER DEFAULT 100,
ADD COLUMN     "gender" VARCHAR(50),
ADD COLUMN     "hangout_spots" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "is_hosteller" BOOLEAN,
ADD COLUMN     "last_active_at" TIMESTAMP(3),
ADD COLUMN     "location_area" VARCHAR(255),
ADD COLUMN     "orientation" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "profile_video_url" VARCHAR(500),
ADD COLUMN     "role" VARCHAR(20) NOT NULL DEFAULT 'user',
ADD COLUMN     "show_gender" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "show_orientation" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "video_preview_url" VARCHAR(500),
ADD COLUMN     "year_of_study" INTEGER;

-- CreateTable
CREATE TABLE "swipes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "swiper_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "action" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "swipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_scores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "total_swipes_out" INTEGER NOT NULL DEFAULT 0,
    "total_right_swipes" INTEGER NOT NULL DEFAULT 0,
    "total_swipes_received" INTEGER NOT NULL DEFAULT 0,
    "total_likes_received" INTEGER NOT NULL DEFAULT 0,
    "messages_sent" INTEGER NOT NULL DEFAULT 0,
    "messages_received" INTEGER NOT NULL DEFAULT 0,
    "messages_replied" INTEGER NOT NULL DEFAULT 0,
    "desirability_score" DOUBLE PRECISION NOT NULL DEFAULT 50.0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_score_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "score_type" VARCHAR(50) NOT NULL DEFAULT 'desirability',
    "old_value" DOUBLE PRECISION NOT NULL,
    "new_value" DOUBLE PRECISION NOT NULL,
    "reason" VARCHAR(100),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_score_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "algorithm_config" (
    "key" VARCHAR(100) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "algorithm_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "action_url" VARCHAR(500),
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "event_type" VARCHAR(50) NOT NULL,
    "event_data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token" VARCHAR(500) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "swipes_swiper_id_idx" ON "swipes"("swiper_id");

-- CreateIndex
CREATE INDEX "swipes_target_id_idx" ON "swipes"("target_id");

-- CreateIndex
CREATE UNIQUE INDEX "swipes_swiper_id_target_id_key" ON "swipes"("swiper_id", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_scores_user_id_key" ON "user_scores"("user_id");

-- CreateIndex
CREATE INDEX "user_scores_desirability_score_idx" ON "user_scores"("desirability_score");

-- CreateIndex
CREATE INDEX "user_score_history_user_id_created_at_idx" ON "user_score_history"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "user_score_history_score_type_created_at_idx" ON "user_score_history"("score_type", "created_at");

-- CreateIndex
CREATE INDEX "user_blocks_blocker_id_idx" ON "user_blocks"("blocker_id");

-- CreateIndex
CREATE INDEX "user_blocks_blocked_id_idx" ON "user_blocks"("blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_blocks_blocker_id_blocked_id_key" ON "user_blocks"("blocker_id", "blocked_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "analytics_events_event_type_created_at_idx" ON "analytics_events"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "analytics_events_user_id_created_at_idx" ON "analytics_events"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_user_id_token_key" ON "device_tokens"("user_id", "token");

-- CreateIndex
CREATE INDEX "safety_reports_reported_user_id_status_idx" ON "safety_reports"("reported_user_id", "status");

-- CreateIndex
CREATE INDEX "users_last_active_at_idx" ON "users"("last_active_at");

-- CreateIndex
CREATE INDEX "users_location_area_idx" ON "users"("location_area");

-- CreateIndex
CREATE INDEX "users_department_year_idx" ON "users"("department", "year");

-- CreateIndex
CREATE INDEX "users_gender_seeking_idx" ON "users"("gender", "seeking");

-- CreateIndex
CREATE INDEX "users_campus_is_hosteller_idx" ON "users"("campus", "is_hosteller");

-- CreateIndex
CREATE INDEX "users_is_verified_last_active_at_idx" ON "users"("is_verified", "last_active_at");
