-- IEM's geotagged Management House document places D-1, EP Block here.
UPDATE "institution_campuses" c
SET "latitude" = 22.572848,
    "longitude" = 88.437446
FROM "institutions" i
WHERE c."institution_id" = i."id"
  AND i."code" = 'IEM-KOLKATA'
  AND c."code" = 'MANAGEMENT_HOUSE';
