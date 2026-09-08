-- Single statement: PostgreSQL concurrent indexes must run outside a transaction block.
CREATE INDEX CONCURRENTLY users_discovery_college_sample_idx ON users(lower(trim(college)),discovery_sample,id) WHERE is_active AND preferences_confirmed_at IS NOT NULL;
