-- 054_tracks_store_featured.sql
--
-- Producer-curated "picks" on the public storefront. Until now,
-- /store rendered an automated "You might also like" strip — the
-- user wanted that automated recommendation on the beat-detail
-- page only, and a producer-picked strip on the catalogue instead.
--
-- This column gives the producer a checkbox in /store-editor that
-- promotes a track into the "Producer's Picks" row above the main
-- catalogue. Independent of store_listed (must be listed to be a
-- pick; not all listed tracks are picks).
--
-- Idempotent.

ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS store_featured boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tracks_store_featured
  ON public.tracks (user_id, store_featured)
  WHERE store_featured = true AND store_listed = true;

NOTIFY pgrst, 'reload schema';
