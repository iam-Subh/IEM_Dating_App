-- Search: finding a classmate by name (SEARCH_SPEC.md, sections 6-8).

-- Findable by name in Search, by people at the same college (section 7).
-- On for everyone: the spec's exception ("off when Stories and follow
-- requests are both off") assumed Stories were on by default; here both are
-- off by default, so it would have hidden almost every account.
ALTER TABLE "users" ADD COLUMN "search_discoverable" BOOLEAN NOT NULL DEFAULT true;

-- Case- and accent-insensitive matching. unaccent() is not immutable, so an
-- index cannot use it directly; this wrapper pins the dictionary.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE OR REPLACE FUNCTION search_name(value text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT ' ' || regexp_replace(lower(public.unaccent('public.unaccent'::regdictionary, value)), '\s+', ' ', 'g') $$;

-- Token-prefix search: a query word matches when ' ' || word begins a word
-- of the normalised name (search_name puts a space before every word), so
-- "pat" finds "Subhankar Patra" and "hank" finds nobody. Only people who can
-- appear in results are indexed.
CREATE INDEX "users_search_name_trgm_idx" ON "users" USING GIN (search_name("name") gin_trgm_ops)
  WHERE "account_status" = 'active' AND "search_discoverable";
