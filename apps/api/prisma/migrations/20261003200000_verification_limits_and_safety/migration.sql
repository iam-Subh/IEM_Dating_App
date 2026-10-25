-- Grace period, reminders, birthday change and ban evasion (apps/mobile/src/features/auth/GOOGLE_SIGNUP_PLAN.md 2.6, 4, 5, 6).
ALTER TABLE "users" ADD COLUMN "paused_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "grace_warning_level" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "verify_push_level" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "expiry_reminder_level" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "birthday_changed_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "signup_android_id" VARCHAR(64);

CREATE TABLE "banned_identifiers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" VARCHAR(20) NOT NULL,
    "value_hash" VARCHAR(64) NOT NULL,
    "user_id" UUID,
    "reason" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "banned_identifiers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "banned_identifiers_kind_value_hash_key" ON "banned_identifiers"("kind", "value_hash");

CREATE TABLE "birthday_change_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "new_birthday" DATE NOT NULL,
    "id_object_key" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "decided_at" TIMESTAMP(3),
    "decided_by" UUID,
    "note" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "birthday_change_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "birthday_change_requests_status_created_at_idx" ON "birthday_change_requests"("status", "created_at");
CREATE INDEX "birthday_change_requests_user_id_idx" ON "birthday_change_requests"("user_id");

-- Birthdays set before this change count as the onboarding one: each account still gets its one change.
