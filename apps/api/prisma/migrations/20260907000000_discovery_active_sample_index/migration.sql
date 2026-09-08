-- One concurrent index per migration. Do not wrap this statement in a transaction.
-- Replaces the obsolete college-text index: retrieval checks institution membership.
CREATE INDEX CONCURRENTLY users_discovery_active_sample_idx
ON users(discovery_sample, id)
WHERE account_status = 'active' AND preferences_confirmed_at IS NOT NULL;
