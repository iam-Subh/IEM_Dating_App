-- Single statement: PostgreSQL concurrent indexes must run outside a transaction block.
CREATE UNIQUE INDEX CONCURRENTLY matches_unordered_pair_key ON matches(LEAST(user1_id,user2_id),GREATEST(user1_id,user2_id));
