-- Single statement: PostgreSQL concurrent indexes must run outside a transaction block.
CREATE INDEX CONCURRENTLY users_discovery_categories_idx ON users USING GIN(show_me_categories);
