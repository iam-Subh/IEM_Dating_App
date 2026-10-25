-- Admin panel (ADMIN_PANEL_PLAN.md): every staff action, and suspensions that end on their own.
CREATE TABLE "admin_audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "admin_id" UUID NOT NULL,
  "action" VARCHAR(80) NOT NULL,
  "target_type" VARCHAR(40),
  "target_id" VARCHAR(80),
  "details" JSONB NOT NULL DEFAULT '{}',
  "status_code" INTEGER,
  "ip" VARCHAR(64),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at");
CREATE INDEX "admin_audit_logs_admin_id_created_at_idx" ON "admin_audit_logs"("admin_id", "created_at");
CREATE INDEX "admin_audit_logs_target_id_idx" ON "admin_audit_logs"("target_id");

ALTER TABLE "users" ADD COLUMN "suspended_until" TIMESTAMP(3);
