-- "Who you see": three options instead of five (apps/mobile/src/features/auth/GOOGLE_SIGNUP_PLAN.md 2.1).
ALTER TABLE "institutions" ADD COLUMN "short_name" VARCHAR(60);

UPDATE "institutions" SET "short_name" = 'IEM' WHERE "code" = 'IEM-KOLKATA';
-- UEM's Kolkata college is known as UEM Newtown, never confused with UEM Jaipur.
UPDATE "institutions" SET "name" = 'University of Engineering and Management, Newtown', "short_name" = 'UEM Newtown'
  WHERE "code" = 'UEM-KOLKATA';
UPDATE "users" SET "college" = 'University of Engineering and Management, Newtown'
  WHERE "college" = 'University of Engineering and Management, Kolkata';
-- Not launched yet: out of every list and verification until it is switched back on.
UPDATE "institutions" SET "short_name" = 'UEM Jaipur', "is_active" = false WHERE "code" = 'UEM-JAIPUR';

-- "My campus" is now "your college" with your own campus first; "Whole group"
-- is "both colleges in your city" (the same people while only Kolkata is live).
UPDATE "users" SET
  "college_scope" = CASE "college_scope" WHEN 'campus' THEN 'college' WHEN 'group' THEN 'city' ELSE "college_scope" END,
  "eligibility_version" = "eligibility_version" + 1
WHERE "college_scope" IN ('campus', 'group');
