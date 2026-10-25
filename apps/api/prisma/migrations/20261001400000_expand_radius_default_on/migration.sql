-- "Show people further away if I run out of profiles" is on by default.
ALTER TABLE "users" ALTER COLUMN "expand_radius" SET DEFAULT true;
UPDATE "users" SET "expand_radius" = true WHERE "expand_radius" = false;
