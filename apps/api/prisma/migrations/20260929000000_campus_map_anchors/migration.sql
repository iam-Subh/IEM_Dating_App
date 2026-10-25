-- Ashram Building is at GN-34/2, west of Gurukul. The original seed gave
-- both buildings the Gurukul coordinate.
UPDATE "institution_campuses" c
SET "latitude" = 22.570139,
    "longitude" = 88.429693
FROM "institutions" i
WHERE c."institution_id" = i."id"
  AND i."code" = 'IEM-KOLKATA'
  AND c."code" = 'ASHRAM';

-- IEM also lists its New Town campus at the UEM Kolkata Action Area III site.
INSERT INTO "institution_campuses"
  ("institution_id", "code", "name", "latitude", "longitude", "sort_order")
SELECT i."id", 'NEW_TOWN', 'New Town', 22.559860, 88.489940, 3
FROM "institutions" i
WHERE i."code" = 'IEM-KOLKATA'
ON CONFLICT ("institution_id", "code") DO NOTHING;

UPDATE "institutions" i
SET "campuses" = (
  SELECT array_agg(c."name" ORDER BY c."sort_order")
  FROM "institution_campuses" c
  WHERE c."institution_id" = i."id" AND c."is_active"
)
WHERE i."code" = 'IEM-KOLKATA';
