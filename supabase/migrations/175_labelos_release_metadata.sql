-- 175_labelos_release_metadata.sql (LABEL-55)
--
-- The release details the "New release" form and the release page ask for and
-- 144 / 158 did not have. Already there and NOT added again: title, type, upc
-- (+ its format CHECK), label_name, c_line, p_line, primary_genre, target_date,
-- release_date (144), store_playback (158); per-track `explicit` lives on
-- release_items (144) and on tracks (173).
-- Missing, added here, all NULLABLE:
--
--   distributor  the distributor the release is PLANNED to go to (free text).
--                `delivered_to` stays the record of who it was delivered to.
--   territories  ISO 3166-1 alpha-2 codes, or 'WW' for worldwide. NULL = not stated.
--   language     language of the release, same shape as tracks.language (173).
--
-- Code that reads or writes the three columns degrades without this migration: a create or edit that does not
-- name them works on a database that has 144 but not 175; one that does answers 503 naming 175.
--
-- No policy, grant or trigger changes: `releases` stays org-only, SELECT policy
-- of 144, writes through the service role. Expand only; no existing row changes.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS first.

ALTER TABLE public.releases ADD COLUMN IF NOT EXISTS distributor text;
ALTER TABLE public.releases ADD COLUMN IF NOT EXISTS territories text[];
ALTER TABLE public.releases ADD COLUMN IF NOT EXISTS language text;

-- The territories rule, one copy, held equal to the Zod contract (OrgReleaseCreate/PatchBodySchema):
-- 1..250 codes of two capital letters, none NULL, each once, and WW (worldwide) only on its own.
-- A function because a CHECK cannot hold a subquery; IMMUTABLE so it may be used in one.
CREATE OR REPLACE FUNCTION public.labelos_territories_ok(t text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT t IS NULL OR (
    cardinality(t) BETWEEN 1 AND 250
    AND array_position(t, NULL) IS NULL
    AND array_to_string(t, ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'
    AND cardinality(t) = (SELECT count(DISTINCT x) FROM unnest(t) AS x)
    AND (NOT ('WW' = ANY (t)) OR cardinality(t) = 1)
  )
$$;

ALTER TABLE public.releases DROP CONSTRAINT IF EXISTS releases_metadata_format;
ALTER TABLE public.releases ADD CONSTRAINT releases_metadata_format CHECK (
  (distributor IS NULL OR char_length(btrim(distributor)) BETWEEN 1 AND 120)
  AND (language IS NULL OR language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$')
  AND public.labelos_territories_ok(territories)
);

NOTIFY pgrst, 'reload schema';
