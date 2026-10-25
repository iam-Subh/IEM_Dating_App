-- Safety tools and data rights (docs/SAFETY_AND_LEGAL.md 3, 5.2).
-- Hidden Words: messages and notes with these are folded away.
ALTER TABLE "users" ADD COLUMN "hidden_words" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
-- DPDP nominee: who may exercise this person's rights if they die or can't.
ALTER TABLE "users" ADD COLUMN "nominee" JSONB;
-- The yearly reminder of the rules (IT Rules 2021).
ALTER TABLE "users" ADD COLUMN "rules_reminded_at" TIMESTAMP(3);

-- Appeals from people who can't sign in (hidden, suspended, banned).
CREATE TABLE "appeals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "email" VARCHAR(254) NOT NULL,
  "message" VARCHAR(2000) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "decided_by" UUID,
  "decided_at" TIMESTAMP(3),
  "note" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "appeals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "appeals_status_created_at_idx" ON "appeals"("status", "created_at");
CREATE INDEX "appeals_user_id_idx" ON "appeals"("user_id");
