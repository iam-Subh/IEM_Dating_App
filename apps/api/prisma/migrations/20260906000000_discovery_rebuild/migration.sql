-- AlterTable
ALTER TABLE "users" ADD COLUMN     "discovery_category" VARCHAR(32),
ADD COLUMN     "discovery_mode" VARCHAR(16),
ADD COLUMN     "eligibility_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "max_age_pref" INTEGER,
ADD COLUMN     "min_age_pref" INTEGER,
ADD COLUMN     "preferences_confirmed_at" TIMESTAMP(3),
ADD COLUMN     "show_me_categories" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "discovery_receipts" (
    "id" UUID NOT NULL,
    "viewer_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "deck_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "algorithm" INTEGER NOT NULL,
    "delivered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visible_at" TIMESTAMP(3),

    CONSTRAINT "discovery_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shadow_rankings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "viewer_id" UUID NOT NULL,
    "deck_id" UUID NOT NULL,
    "report" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shadow_rankings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discovery_receipts_delivered_at_idx" ON "discovery_receipts"("delivered_at");

-- CreateIndex
CREATE INDEX "discovery_receipts_candidate_id_visible_at_idx" ON "discovery_receipts"("candidate_id", "visible_at");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_receipts_viewer_id_deck_id_sequence_key" ON "discovery_receipts"("viewer_id", "deck_id", "sequence");

-- CreateIndex
CREATE INDEX "shadow_rankings_created_at_idx" ON "shadow_rankings"("created_at");
