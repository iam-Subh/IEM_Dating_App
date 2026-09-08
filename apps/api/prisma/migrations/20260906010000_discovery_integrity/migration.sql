ALTER TABLE users ADD COLUMN discovery_sample INTEGER NOT NULL DEFAULT floor(random() * 1048576)::integer;
ALTER TABLE users ADD CONSTRAINT users_discovery_preferences_check CHECK (
  preferences_confirmed_at IS NULL OR (
    discovery_category IN ('man','woman','nonbinary') AND discovery_category IS NOT NULL AND
    show_me_categories IS NOT NULL AND cardinality(show_me_categories) BETWEEN 1 AND 3 AND show_me_categories <@ ARRAY['man','woman','nonbinary']::text[] AND
    min_age_pref BETWEEN 18 AND 120 AND max_age_pref BETWEEN min_age_pref AND 120 AND
    min_age_pref IS NOT NULL AND max_age_pref IS NOT NULL AND
    discovery_mode IN ('college','distance') AND discovery_mode IS NOT NULL
  )
);
-- Abort for existing duplicate pairs. Do not merge or delete existing matches automatically.
