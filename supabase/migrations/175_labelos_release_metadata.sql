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
-- No policy, grant or trigger changes: `releases` stays org-only, SELECT policy
-- of 144, writes through the service role. Expand only; no existing row changes.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS first.

ALTER TABLE public.releases ADD COLUMN IF NOT EXISTS distributor text;
ALTER TABLE public.releases ADD COLUMN IF NOT EXISTS territories text[];
ALTER TABLE public.releases ADD COLUMN IF NOT EXISTS language text;

ALTER TABLE public.releases DROP CONSTRAINT IF EXISTS releases_metadata_format;
ALTER TABLE public.releases ADD CONSTRAINT releases_metadata_format CHECK (
  (distributor IS NULL OR char_length(btrim(distributor)) BETWEEN 1 AND 120)
  AND (language IS NULL OR language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$')
  AND (territories IS NULL OR (
        cardinality(territories) BETWEEN 1 AND 250
        AND array_to_string(territories, ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'
  ))
);

NOTIFY pgrst, 'reload schema';
