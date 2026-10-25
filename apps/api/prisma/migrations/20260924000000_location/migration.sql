-- Location (LOCATION_SPEC.md): saved places, campuses, college scope, map
-- places, privacy switches, and a coarser 0.02 degree grid.
--
-- Hand-edited from `prisma migrate diff`: the diff also proposed dropping
-- chat_message_marks_message_id_fkey, which is unrelated drift and is left
-- alone here on purpose.

-- AlterTable
ALTER TABLE "institutions" ADD COLUMN     "city" VARCHAR(80),
ADD COLUMN     "group_code" VARCHAR(40);

-- AlterTable
ALTER TABLE "student_memberships" ADD COLUMN     "campus_confirmed" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "active_place_id" UUID,
ADD COLUMN     "campus_id" UUID,
ADD COLUMN     "college_scope" VARCHAR(16) NOT NULL DEFAULT 'college',
ADD COLUMN     "expand_radius" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hide_distance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hide_from_maps" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "invisible_end" SMALLINT,
ADD COLUMN     "invisible_start" SMALLINT,
ADD COLUMN     "live_latitude" DECIMAL(9,6),
ADD COLUMN     "live_longitude" DECIMAL(9,6),
ADD COLUMN     "live_updated_at" TIMESTAMP(3),
ADD COLUMN     "location_accuracy" VARCHAR(16),
ADD COLUMN     "location_accuracy_m" INTEGER,
ADD COLUMN     "location_source" VARCHAR(8) NOT NULL DEFAULT 'live';

-- CreateTable
CREATE TABLE "institution_campuses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "institution_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "institution_campuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_places" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "label" VARCHAR(24) NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "hide_here" BOOLEAN NOT NULL DEFAULT false,
    "last_visited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "map_places" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" VARCHAR(16) NOT NULL,
    "external_id" VARCHAR(160) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "subtitle" VARCHAR(200),
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "map_places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_map_places" (
    "user_id" UUID NOT NULL,
    "place_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_map_places_pkey" PRIMARY KEY ("user_id","place_id")
);

-- CreateIndex
CREATE INDEX "institution_campuses_institution_id_idx" ON "institution_campuses"("institution_id");

-- CreateIndex
CREATE UNIQUE INDEX "institution_campuses_institution_id_code_key" ON "institution_campuses"("institution_id", "code");

-- CreateIndex
CREATE INDEX "saved_places_user_id_idx" ON "saved_places"("user_id");

-- CreateIndex
CREATE INDEX "saved_places_last_visited_at_idx" ON "saved_places"("last_visited_at");

-- CreateIndex
CREATE UNIQUE INDEX "saved_places_user_id_latitude_longitude_key" ON "saved_places"("user_id", "latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "map_places_external_id_key" ON "map_places"("external_id");

-- CreateIndex
CREATE INDEX "map_places_latitude_longitude_idx" ON "map_places"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "user_map_places_place_id_idx" ON "user_map_places"("place_id");

-- CreateIndex
CREATE INDEX "users_campus_id_idx" ON "users"("campus_id");

-- ---------------------------------------------------------------------------
-- Data
-- ---------------------------------------------------------------------------

-- The IEM-UEM group and its cities (section 8.4). Institutions outside a group
-- keep group_code NULL and can only ever reach their own members.
UPDATE "institutions" SET "group_code" = 'IEM-UEM', "city" = 'Kolkata' WHERE "code" IN ('IEM-KOLKATA', 'UEM-KOLKATA');
UPDATE "institutions" SET "group_code" = 'IEM-UEM', "city" = 'Jaipur'  WHERE "code" = 'UEM-JAIPUR';

-- Campuses (section 3.5). Coordinates come from OpenStreetMap (Photon):
--   IEM, Sector V, Salt Lake: way 134101300 -> 22.57421, 88.43369. Gurukul,
--     Ashram and Management House are all in Sector V, well inside one
--     0.02 degree cell, so they share this anchor.
--   UEM Kolkata, Action Area III, New Town: way 514278915 -> 22.55986, 88.48994.
--   UEM Jaipur is not in OpenStreetMap; its coordinates stay NULL until an
--     admin sets them from a map pin. NULL disables only the features that
--     need them (campus anchor, map marker, "visiting" label).
INSERT INTO "institution_campuses" ("institution_id", "code", "name", "latitude", "longitude", "sort_order")
SELECT i."id", v."code", v."name", v."lat", v."lng", v."sort"
FROM "institutions" i
JOIN (VALUES
  ('IEM-KOLKATA', 'GURUKUL',          'Gurukul',          22.574210::numeric, 88.433690::numeric, 0),
  ('IEM-KOLKATA', 'ASHRAM',           'Ashram',           22.574210::numeric, 88.433690::numeric, 1),
  ('IEM-KOLKATA', 'MANAGEMENT_HOUSE', 'Management House', 22.574210::numeric, 88.433690::numeric, 2),
  ('UEM-KOLKATA', 'NEW_TOWN',         'New Town',         22.559860::numeric, 88.489940::numeric, 0),
  ('UEM-JAIPUR',  'JAIPUR',           'Gurukul (Jaipur)', NULL::numeric,      NULL::numeric,      0)
) AS v("institution_code", "code", "name", "lat", "lng", "sort") ON v."institution_code" = i."code"
ON CONFLICT ("institution_id", "code") DO NOTHING;

-- Keep the legacy campus-name list in step for clients that still read it.
UPDATE "institutions" i SET "campuses" = sub."names"
FROM (
  SELECT "institution_id", array_agg("name" ORDER BY "sort_order") AS "names"
  FROM "institution_campuses" GROUP BY "institution_id"
) sub
WHERE sub."institution_id" = i."id";

-- Backfill campus_id from the free-text campus, within the member's own
-- institution only, so "Gurukul" can never resolve to the Jaipur campus.
UPDATE "users" u SET "campus_id" = c."id", "campus" = c."name"
FROM "student_memberships" m
JOIN "institution_campuses" c ON c."institution_id" = m."institution_id"
WHERE m."user_id" = u."id"
  AND u."campus" IS NOT NULL
  AND lower(btrim(u."campus")) = lower(c."name");

-- An institution with exactly one campus leaves no choice to make.
UPDATE "users" u SET "campus_id" = c."id", "campus" = c."name"
FROM "student_memberships" m
JOIN "institution_campuses" c ON c."institution_id" = m."institution_id"
WHERE m."user_id" = u."id"
  AND u."campus_id" IS NULL
  AND (SELECT count(*) FROM "institution_campuses" x WHERE x."institution_id" = m."institution_id" AND x."is_active") = 1;

-- Re-snap stored cells from the 0.01 to the 0.02 degree grid (section 6.4).
-- Idempotent: a value already on the 0.02 grid maps to itself. Precision only
-- ever decreases, so nobody becomes more precisely locatable.
UPDATE "users"
SET "latitude"  = round("latitude"  / 0.02) * 0.02,
    "longitude" = round("longitude" / 0.02) * 0.02
WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;

-- The speed check's baseline starts as the current cell.
UPDATE "users"
SET "live_latitude" = "latitude", "live_longitude" = "longitude", "live_updated_at" = "location_updated_at"
WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;

-- Radius presets 5 / 10 / 15 / 25 / 50 / 100 km (section 6.5), rounding up so
-- nobody's current audience shrinks.
UPDATE "users" SET "distance_preference" = CASE
  WHEN "distance_preference" IS NULL THEN 100
  WHEN "distance_preference" <= 5  THEN 5
  WHEN "distance_preference" <= 10 THEN 10
  WHEN "distance_preference" <= 15 THEN 15
  WHEN "distance_preference" <= 25 THEN 25
  WHEN "distance_preference" <= 50 THEN 50
  ELSE 100 END;

ALTER TABLE "users" ADD CONSTRAINT "users_college_scope_check" CHECK ("college_scope" IN ('campus', 'college', 'city', 'group'));
ALTER TABLE "users" ADD CONSTRAINT "users_location_source_check" CHECK ("location_source" IN ('live', 'place'));
ALTER TABLE "users" ADD CONSTRAINT "users_invisible_hours_check" CHECK (
  ("invisible_start" IS NULL AND "invisible_end" IS NULL) OR
  ("invisible_start" BETWEEN 0 AND 1439 AND "invisible_end" BETWEEN 0 AND 1439 AND "invisible_start" <> "invisible_end")
);
