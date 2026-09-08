ALTER TABLE "safety_reports"
  ADD COLUMN "source_type" VARCHAR(24),
  ADD COLUMN "source_id" UUID,
  ADD COLUMN "evidence_snapshot" JSONB;

CREATE INDEX "safety_reports_source_type_source_id_idx"
  ON "safety_reports"("source_type", "source_id");
