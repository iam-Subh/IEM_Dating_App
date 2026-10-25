-- Age preferences run 18-35 (@iem-dating/shared/age): the latest usual PhD
-- finish in the IEM-UEM group (18 + B.Tech 4 + M.Tech 2 + PhD up to 6 = 30)
-- plus five years. Existing preferences are brought inside it.
UPDATE "users" SET
  "min_age_pref" = LEAST(GREATEST("min_age_pref", 18), 35),
  "max_age_pref" = LEAST(GREATEST("max_age_pref", 18), 35)
WHERE ("min_age_pref" IS NOT NULL AND ("min_age_pref" < 18 OR "min_age_pref" > 35))
   OR ("max_age_pref" IS NOT NULL AND ("max_age_pref" < 18 OR "max_age_pref" > 35));
