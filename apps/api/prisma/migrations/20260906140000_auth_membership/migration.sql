ALTER TABLE "users"
ADD COLUMN "email_verified_at" TIMESTAMP(3),
ADD COLUMN "phone_verified_at" TIMESTAMP(3);

ALTER TABLE "user_sessions"
ADD COLUMN "family_id" UUID,
ADD COLUMN "replaced_by_jti" VARCHAR(255),
ADD COLUMN "revoked_at" TIMESTAMP(3),
ADD COLUMN "revoke_reason" VARCHAR(40),
ADD COLUMN "last_used_at" TIMESTAMP(3);

UPDATE "user_sessions"
SET "family_id" = gen_random_uuid()
WHERE "family_id" IS NULL;

ALTER TABLE "user_sessions"
ALTER COLUMN "family_id" SET NOT NULL,
ALTER COLUMN "family_id" SET DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX "user_sessions_replaced_by_jti_key"
ON "user_sessions"("replaced_by_jti");

CREATE TABLE "institutions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "allowed_domains" TEXT[] NOT NULL,
  "campuses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "institutions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "institutions_code_key" ON "institutions"("code");

CREATE TABLE "student_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "institution_id" UUID NOT NULL,
  "institutional_email" VARCHAR(255) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'verified',
  "verification_method" VARCHAR(40) NOT NULL DEFAULT 'institution_email',
  "verified_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "student_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "student_memberships_user_id_key" ON "student_memberships"("user_id");
CREATE UNIQUE INDEX "student_memberships_institutional_email_key" ON "student_memberships"("institutional_email");
CREATE INDEX "student_memberships_institution_id_status_idx" ON "student_memberships"("institution_id", "status");
CREATE INDEX "student_memberships_status_expires_at_idx" ON "student_memberships"("status", "expires_at");

INSERT INTO "institutions" ("code", "name", "allowed_domains", "campuses") VALUES
  ('IEM-KOLKATA', 'Institute of Engineering and Management, Kolkata', ARRAY['iem.edu.in'], ARRAY['Kolkata']),
  ('UEM-KOLKATA', 'University of Engineering and Management, Kolkata', ARRAY['uem.edu.in'], ARRAY['New Town']),
  ('UEM-JAIPUR', 'University of Engineering and Management, Jaipur', ARRAY['uem.edu.in'], ARRAY['Jaipur'])
ON CONFLICT ("code") DO NOTHING;
