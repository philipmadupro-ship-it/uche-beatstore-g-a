-- 021_track_pricing_and_description.sql
--
-- Per-track listing fields. The creator_profiles row holds the
-- producer's DEFAULT lease/exclusive prices — useful when every
-- beat is priced the same — but real catalogs have outliers:
-- a fire flagship beat priced higher than the rest, a rough demo
-- priced lower, a remix priced exclusive-only.
--
-- These columns let the producer override the profile defaults
-- per-track. When NULL the share page falls back to the profile.
--
--   description — short prose blurb shown on the Client variant
--                 track list. "808 drill, dark vibe, 140 bpm.
--                 Cleared sample. Open to placements." kind of
--                 thing. Multi-line; whitespace preserved.
--
--   lease_price_usd
--   exclusive_price_usd
--               — numeric overrides. NULL = inherit from
--                 creator_profiles.license_*_price_usd.

ALTER TABLE tracks
  ADD COLUMN IF NOT EXISTS description         text,
  ADD COLUMN IF NOT EXISTS lease_price_usd     numeric,
  ADD COLUMN IF NOT EXISTS exclusive_price_usd numeric;

-- Refresh PostgREST's schema cache so the new columns are
-- immediately queryable through the auto-API.
NOTIFY pgrst, 'reload schema';
