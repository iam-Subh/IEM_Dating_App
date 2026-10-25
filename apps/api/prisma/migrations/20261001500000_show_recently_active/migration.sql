-- "Show recently active status": on by default.
ALTER TABLE "users" ADD COLUMN "show_recently_active" BOOLEAN NOT NULL DEFAULT true;
