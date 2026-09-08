-- The account lifecycle migration dropped the old index with the is_active column.
-- One concurrent index per migration. Do not wrap this statement in a transaction.
CREATE INDEX CONCURRENTLY users_discovery_created_idx
ON users(created_at DESC, id)
WHERE account_status = 'active' AND preferences_confirmed_at IS NOT NULL;
