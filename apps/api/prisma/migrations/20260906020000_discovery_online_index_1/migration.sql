-- Single statement: PostgreSQL concurrent indexes must run outside a transaction block.
CREATE INDEX CONCURRENTLY users_discovery_sample_id_idx ON users(discovery_sample,id);
