-- Real-person check (apps/mobile/src/features/verification/PHOTO_VERIFICATION_PLAN.md).
ALTER TABLE "users" ADD COLUMN "real_person_verified_at" TIMESTAMP(3);

CREATE TABLE "face_verifications" (
    "user_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(60),
    "verified_at" TIMESTAMP(3),
    "failure_streak" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "face_verifications_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "face_keys" (
    "user_id" UUID NOT NULL,
    "cipher" TEXT NOT NULL,
    "model" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "face_keys_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "face_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "actions" TEXT[],
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "result" VARCHAR(30),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "face_challenges_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "face_challenges_user_id_created_at_idx" ON "face_challenges"("user_id", "created_at");

CREATE TABLE "face_review_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "reason" VARCHAR(60) NOT NULL,
    "snapshot_keys" TEXT[],
    "details" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "note" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "face_review_cases_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "face_review_cases_status_created_at_idx" ON "face_review_cases"("status", "created_at");
CREATE INDEX "face_review_cases_user_id_idx" ON "face_review_cases"("user_id");

CREATE TABLE "face_media_checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "media_url" VARCHAR(500) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "distance" DOUBLE PRECISION,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "face_media_checks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "face_media_checks_user_id_media_url_key" ON "face_media_checks"("user_id", "media_url");
