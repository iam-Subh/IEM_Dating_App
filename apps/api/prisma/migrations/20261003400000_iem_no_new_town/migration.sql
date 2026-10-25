-- IEM's campuses are Gurukul, Ashram and Management House (Sector V, Salt Lake).
-- The New Town campus (Plot III-B/5, Action Area III) is UEM Newtown's - often
-- called "IEM Newtown" - and was listed under IEM by mistake. Switched off, not
-- deleted; nobody had chosen it.
UPDATE "institution_campuses" SET "is_active" = false
WHERE "code" = 'NEW_TOWN'
  AND "institution_id" = (SELECT "id" FROM "institutions" WHERE "code" = 'IEM-KOLKATA');
