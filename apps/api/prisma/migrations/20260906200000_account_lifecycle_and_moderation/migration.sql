ALTER TABLE "users" ADD COLUMN "account_status" VARCHAR(24) NOT NULL DEFAULT 'active';
UPDATE "users" SET "account_status" = 'restricted' WHERE "is_active" = FALSE;
DROP INDEX IF EXISTS "users_is_active_gender_seeking_last_active_at_idx";
ALTER TABLE "users" DROP COLUMN "is_active";

ALTER TABLE "users" RENAME COLUMN "year" TO "graduation_year";
UPDATE "users"
SET "year_of_study" = "graduation_year"
WHERE "graduation_year" BETWEEN 1 AND 10
  AND "year_of_study" IS NULL;
UPDATE "users"
SET "graduation_year" = NULL
WHERE "graduation_year" IS NOT NULL
  AND "graduation_year" NOT BETWEEN 2020 AND 2100;
ALTER INDEX IF EXISTS "users_year_idx" RENAME TO "users_graduation_year_idx";
ALTER INDEX IF EXISTS "users_department_year_idx" RENAME TO "users_department_graduation_year_idx";

CREATE TABLE "moderation_cases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "subject_user_id" UUID NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'open',
  "priority" VARCHAR(16) NOT NULL DEFAULT 'normal',
  "assigned_admin_id" UUID,
  "restriction_applied_at" TIMESTAMP(3),
  "resolution" TEXT,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "moderation_cases_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "moderation_cases_subject_user_id_status_idx" ON "moderation_cases"("subject_user_id", "status");
CREATE INDEX "moderation_cases_status_priority_created_at_idx" ON "moderation_cases"("status", "priority", "created_at");

ALTER TABLE "safety_reports" ADD COLUMN "moderation_case_id" UUID;
CREATE INDEX "safety_reports_moderation_case_id_idx" ON "safety_reports"("moderation_case_id");

CREATE TABLE "account_data_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "type" VARCHAR(24) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'pending',
  "result" JSONB,
  "error" VARCHAR(500),
  "scheduled_for" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_data_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "account_data_requests_user_id_type_status_idx" ON "account_data_requests"("user_id", "type", "status");
CREATE INDEX "account_data_requests_type_status_scheduled_for_idx" ON "account_data_requests"("type", "status", "scheduled_for");
CREATE INDEX "account_data_requests_status_expires_at_idx" ON "account_data_requests"("status", "expires_at");
