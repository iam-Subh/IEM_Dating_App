-- Show distances in kilometres or miles. Everything is still stored in km.
ALTER TABLE "users" ADD COLUMN "distance_unit" VARCHAR(2) NOT NULL DEFAULT 'km';
