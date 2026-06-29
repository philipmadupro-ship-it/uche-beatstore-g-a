-- 098_store_catalogue_index.sql
--
-- The public storefront catalogue query (src/app/api/store/route.ts) filters
-- `store_listed = true` and orders by `store_sort_order` (asc, nulls last) then
-- `created_at` (desc). There was no index supporting it, so the query does a
-- seq scan + sort. Negligible at 600 tracks, but this is the hottest public,
-- edge-cache-missing read, so we give it a partial index that matches the
-- filter + order and stays small (only listed rows are indexed).
--
-- NOTE on track_tags: an earlier audit flagged a "missing track_tags(track_id)
-- index". On inspection track_tags' PRIMARY KEY is (track_id, tag) (mig 001),
-- whose leading column is track_id — so track_id lookups/joins are ALREADY
-- served by the PK btree. Adding a standalone track_tags(track_id) index would
-- be redundant (extra write cost, no read gain), so we intentionally do NOT.
--
-- Idempotent (IF NOT EXISTS). Safe to re-run.

CREATE INDEX IF NOT EXISTS idx_tracks_store_catalogue
  ON public.tracks (store_sort_order, created_at DESC)
  WHERE store_listed = true;

NOTIFY pgrst, 'reload schema';
