-- Single statement: PostgreSQL concurrent indexes must run outside a transaction block.
CREATE INDEX CONCURRENTLY users_discovery_created_idx ON users(created_at DESC,id) WHERE is_active AND preferences_confirmed_at IS NOT NULL;
