CREATE INDEX CONCURRENTLY IF NOT EXISTS swipes_actor_history_idx ON swipes(swiper_id, created_at DESC, id);
