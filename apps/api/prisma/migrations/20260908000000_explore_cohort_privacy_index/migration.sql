-- Prisma Migrate must run this migration without a transaction on PostgreSQL.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_preferences_interests_gin_idx"
  ON "users" USING GIN (("preferences"->'interests'))
  WHERE "account_status" = 'active' AND "preferences_confirmed_at" IS NOT NULL;
