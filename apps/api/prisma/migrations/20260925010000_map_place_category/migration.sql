-- The kind of place a map spot is (Cafe, Restaurant, Park...), shown in the
-- map's place panel (LOCATION_SPEC.md 9.2).
ALTER TABLE "map_places" ADD COLUMN "category" VARCHAR(40);
