CREATE INDEX CONCURRENTLY IF NOT EXISTS "swipes_incoming_order_idx" ON "swipes"("target_id", "action", "created_at" DESC, "swiper_id");
